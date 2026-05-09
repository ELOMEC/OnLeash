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

const USDC_DECIMALS: u8 = 6;
const INITIAL_USDC: u64 = 1_000_000_000;
const TOTAL_ALLOWANCE: u64 = 100_000_000;
const PER_TX_LIMIT: u64 = 5_000_000;
const DAILY_LIMIT: u64 = 50_000_000;
const DURATION_SECONDS: i64 = 86_400 * 30;
const DEPOSIT_AMOUNT: u64 = 100_000_000;
const TEST_TIMESTAMP: i64 = 1_735_689_600;

struct TestCtx {
    svm: LiteSVM,
    program_id: Pubkey,
    delegate: Keypair,
    mint: Pubkey,
    agent_budget: Pubkey,
    budget_ata: Pubkey,
    recipient_ata: Pubkey,
}

fn setup_funded_budget() -> TestCtx {
    let program_id = onleash::id();
    let mut svm = LiteSVM::new();

    let bytes = include_bytes!("../../../target/deploy/onleash.so");
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
        delegate,
        mint,
        agent_budget,
        budget_ata,
        recipient_ata,
    }
}

fn execute_payment(
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

fn budget_state(svm: &LiteSVM, agent_budget: &Pubkey) -> onleash::state::AgentBudget {
    let acc = svm.get_account(agent_budget).expect("budget account");
    onleash::state::AgentBudget::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

fn token_amount(svm: &LiteSVM, ata: &Pubkey) -> u64 {
    let acc = svm.get_account(ata).expect("token account");
    TokenAccount::try_deserialize(&mut acc.data.as_slice())
        .unwrap()
        .amount
}

fn advance_time(ctx: &mut TestCtx, seconds: i64) {
    let mut clock = ctx.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += seconds;
    ctx.svm.set_sysvar::<Clock>(&clock);
    ctx.svm.expire_blockhash();
}

fn assert_error_contains(err: &FailedTransactionMetadata, msg: &str) {
    let logs = err.meta.logs.join("\n");
    assert!(
        logs.contains(msg),
        "expected '{}' in logs:\n{}",
        msg,
        logs
    );
}

#[test]
fn happy_path_execute_payment() {
    let mut ctx = setup_funded_budget();

    let amount = 1_000_000;
    execute_payment(&mut ctx, amount).expect("payment should succeed");

    let state = budget_state(&ctx.svm, &ctx.agent_budget);
    assert_eq!(state.spent_total, amount);
    assert_eq!(state.daily_spent, amount);
    assert_eq!(state.nonce, 1);

    assert_eq!(token_amount(&ctx.svm, &ctx.recipient_ata), amount);
    assert_eq!(
        token_amount(&ctx.svm, &ctx.budget_ata),
        DEPOSIT_AMOUNT - amount
    );
}

#[test]
fn per_tx_limit_exceeded_rejected() {
    let mut ctx = setup_funded_budget();
    let err = execute_payment(&mut ctx, PER_TX_LIMIT + 1).expect_err("should fail");
    assert_error_contains(&err, "PerTxLimitExceeded");
}

#[test]
fn daily_limit_exceeded_rejected() {
    let mut ctx = setup_funded_budget();

    // 10 successful payments fills daily_spent to DAILY_LIMIT (10 × 5 = 50)
    for _ in 0..10 {
        execute_payment(&mut ctx, PER_TX_LIMIT).expect("payment should succeed");
        ctx.svm.expire_blockhash();
    }

    // 11th payment of any amount > 0 must exceed daily limit
    let err = execute_payment(&mut ctx, 1).expect_err("should fail");
    assert_error_contains(&err, "DailyLimitExceeded");
}

#[test]
fn expired_budget_rejected() {
    let mut ctx = setup_funded_budget();
    advance_time(&mut ctx, DURATION_SECONDS + 1);
    let err = execute_payment(&mut ctx, 1_000_000).expect_err("should fail");
    assert_error_contains(&err, "BudgetExpired");
}

#[test]
fn daily_window_resets_after_24h() {
    let mut ctx = setup_funded_budget();

    execute_payment(&mut ctx, PER_TX_LIMIT).unwrap();
    let before = budget_state(&ctx.svm, &ctx.agent_budget);
    assert_eq!(before.daily_spent, PER_TX_LIMIT);

    advance_time(&mut ctx, 86_401);

    execute_payment(&mut ctx, PER_TX_LIMIT).expect("payment after reset should succeed");
    let after = budget_state(&ctx.svm, &ctx.agent_budget);
    assert_eq!(after.daily_spent, PER_TX_LIMIT, "daily_spent should reset");
    assert_eq!(
        after.spent_total,
        PER_TX_LIMIT * 2,
        "spent_total accumulates"
    );
}
