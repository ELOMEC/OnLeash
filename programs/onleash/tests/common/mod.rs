#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::*,
        solana_program::instruction::Instruction,
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{associated_token::get_associated_token_address, token::TokenAccount},
    litesvm::{types::FailedTransactionMetadata, LiteSVM},
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub const USDC_DECIMALS: u8 = 6;
pub const INITIAL_USDC: u64 = 1_000_000_000;
pub const TOTAL_ALLOWANCE: u64 = 100_000_000;
pub const PER_TX_LIMIT: u64 = 5_000_000;
pub const DAILY_LIMIT: u64 = 50_000_000;
pub const DURATION_SECONDS: i64 = 86_400 * 30;
pub const DEPOSIT_AMOUNT: u64 = 100_000_000;
pub const TEST_TIMESTAMP: i64 = 1_735_689_600;

pub struct TestCtx {
    pub svm: LiteSVM,
    pub program_id: Pubkey,
    pub owner: Keypair,
    pub delegate: Keypair,
    pub mint: Pubkey,
    pub agent_budget: Pubkey,
    pub budget_ata: Pubkey,
    pub owner_ata: Pubkey,
    pub recipient_owner: Keypair,
    pub recipient_ata: Pubkey,
}

pub fn setup_funded_budget() -> TestCtx {
    let program_id = onleash::id();
    let mut svm = LiteSVM::new();

    let bytes = include_bytes!("../../../../target/deploy/onleash.so");
    svm.add_program(program_id, bytes).unwrap();

    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = TEST_TIMESTAMP;
    svm.set_sysvar::<Clock>(&clock);

    let owner = Keypair::new();
    let delegate = Keypair::new();
    let mint_authority = Keypair::new();
    let recipient_owner = Keypair::new();

    svm.airdrop(&owner.pubkey(), 10 * 1_000_000_000).unwrap();
    svm.airdrop(&delegate.pubkey(), 5 * 1_000_000_000).unwrap();
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&recipient_owner.pubkey(), 1_000_000_000).unwrap();

    let mint = CreateMint::new(&mut svm, &mint_authority)
        .decimals(USDC_DECIMALS)
        .send()
        .unwrap();

    CreateAssociatedTokenAccount::new(&mut svm, &owner, &mint)
        .send()
        .unwrap();
    let owner_ata = get_associated_token_address(&owner.pubkey(), &mint);

    MintTo::new(&mut svm, &mint_authority, &mint, &owner_ata, INITIAL_USDC)
        .send()
        .unwrap();

    let (agent_budget, _bump) = Pubkey::find_program_address(
        &[b"agent", owner.pubkey().as_ref(), delegate.pubkey().as_ref()],
        &program_id,
    );
    let budget_ata = get_associated_token_address(&agent_budget, &mint);

    let ix_data = onleash::instruction::InitializeBudget {
        delegate: delegate.pubkey(),
        total_allowance: TOTAL_ALLOWANCE,
        per_tx_limit: PER_TX_LIMIT,
        daily_limit: DAILY_LIMIT,
        duration_seconds: DURATION_SECONDS,
        deposit_amount: DEPOSIT_AMOUNT,
    }
    .data();
    let metas = onleash::accounts::InitializeBudget {
        owner: owner.pubkey(),
        agent_budget,
        mint,
        owner_ata,
        budget_ata,
        system_program: anchor_lang::solana_program::system_program::ID,
        token_program: anchor_spl::token::ID,
        associated_token_program: anchor_spl::associated_token::ID,
    }
    .to_account_metas(None);
    let ix = Instruction::new_with_bytes(program_id, &ix_data, metas);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&owner.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&owner]).unwrap();
    svm.send_transaction(tx).unwrap();

    CreateAssociatedTokenAccount::new(&mut svm, &recipient_owner, &mint)
        .send()
        .unwrap();
    let recipient_ata = get_associated_token_address(&recipient_owner.pubkey(), &mint);

    TestCtx {
        svm,
        program_id,
        owner,
        delegate,
        mint,
        agent_budget,
        budget_ata,
        owner_ata,
        recipient_owner,
        recipient_ata,
    }
}

pub fn budget_state(svm: &LiteSVM, agent_budget: &Pubkey) -> onleash::state::AgentBudget {
    let acc = svm.get_account(agent_budget).expect("budget account");
    onleash::state::AgentBudget::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

pub fn token_amount(svm: &LiteSVM, ata: &Pubkey) -> u64 {
    let acc = svm.get_account(ata).expect("token account");
    TokenAccount::try_deserialize(&mut acc.data.as_slice())
        .unwrap()
        .amount
}

pub fn account_lamports(svm: &LiteSVM, pubkey: &Pubkey) -> u64 {
    svm.get_account(pubkey).map(|a| a.lamports).unwrap_or(0)
}

pub fn advance_time(ctx: &mut TestCtx, seconds: i64) {
    let mut clock = ctx.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += seconds;
    ctx.svm.set_sysvar::<Clock>(&clock);
    ctx.svm.expire_blockhash();
}

pub fn assert_error_contains(err: &FailedTransactionMetadata, msg: &str) {
    let logs = err.meta.logs.join("\n");
    assert!(
        logs.contains(msg),
        "expected '{}' in logs:\n{}",
        msg,
        logs
    );
}

pub fn execute_payment(
    ctx: &mut TestCtx,
    amount: u64,
) -> std::result::Result<(), FailedTransactionMetadata> {
    let ix_data = onleash::instruction::ExecutePayment { amount }.data();
    let metas = onleash::accounts::ExecutePayment {
        delegate: ctx.delegate.pubkey(),
        agent_budget: ctx.agent_budget,
        mint: ctx.mint,
        budget_ata: ctx.budget_ata,
        recipient_ata: ctx.recipient_ata,
        token_program: anchor_spl::token::ID,
    }
    .to_account_metas(None);
    let ix = Instruction::new_with_bytes(ctx.program_id, &ix_data, metas);
    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.delegate.pubkey()), &blockhash);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.delegate]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ())
}

pub fn top_up(
    ctx: &mut TestCtx,
    amount: u64,
) -> std::result::Result<(), FailedTransactionMetadata> {
    let ix_data = onleash::instruction::TopUp { amount }.data();
    let metas = onleash::accounts::TopUp {
        owner: ctx.owner.pubkey(),
        agent_budget: ctx.agent_budget,
        mint: ctx.mint,
        owner_ata: ctx.owner_ata,
        budget_ata: ctx.budget_ata,
        token_program: anchor_spl::token::ID,
    }
    .to_account_metas(None);
    let ix = Instruction::new_with_bytes(ctx.program_id, &ix_data, metas);
    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.owner.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.owner]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ())
}

pub fn update_policy(
    ctx: &mut TestCtx,
    new_per_tx_limit: Option<u64>,
    new_daily_limit: Option<u64>,
    new_paused: Option<bool>,
    new_expires_at: Option<i64>,
) -> std::result::Result<(), FailedTransactionMetadata> {
    let ix_data = onleash::instruction::UpdatePolicy {
        new_per_tx_limit,
        new_daily_limit,
        new_paused,
        new_expires_at,
    }
    .data();
    let metas = onleash::accounts::UpdatePolicy {
        owner: ctx.owner.pubkey(),
        agent_budget: ctx.agent_budget,
    }
    .to_account_metas(None);
    let ix = Instruction::new_with_bytes(ctx.program_id, &ix_data, metas);
    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.owner.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.owner]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ())
}

pub fn close_budget(
    ctx: &mut TestCtx,
) -> std::result::Result<(), FailedTransactionMetadata> {
    let ix_data = onleash::instruction::CloseBudget {}.data();
    let metas = onleash::accounts::CloseBudget {
        owner: ctx.owner.pubkey(),
        agent_budget: ctx.agent_budget,
        mint: ctx.mint,
        budget_ata: ctx.budget_ata,
        owner_ata: ctx.owner_ata,
        token_program: anchor_spl::token::ID,
    }
    .to_account_metas(None);
    let ix = Instruction::new_with_bytes(ctx.program_id, &ix_data, metas);
    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.owner.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.owner]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ())
}
