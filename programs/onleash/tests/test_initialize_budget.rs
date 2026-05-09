use {
    anchor_lang::{
        prelude::*,
        solana_program::instruction::Instruction,
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{associated_token::get_associated_token_address, token::TokenAccount},
    litesvm::LiteSVM,
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USDC_DECIMALS: u8 = 6;
const INITIAL_USDC: u64 = 1_000_000_000; // 1000 USDC at 6 decimals
const TOTAL_ALLOWANCE: u64 = 100_000_000; // 100 USDC
const PER_TX_LIMIT: u64 = 5_000_000; // 5 USDC
const DAILY_LIMIT: u64 = 50_000_000; // 50 USDC
const DURATION_SECONDS: i64 = 86_400 * 30; // 30 days
const DEPOSIT_AMOUNT: u64 = 100_000_000; // 100 USDC
const TEST_TIMESTAMP: i64 = 1_735_689_600; // 2025-01-01 UTC

#[test]
fn happy_path_initialize_budget() {
    let program_id = onleash::id();
    let mut svm = LiteSVM::new();

    let bytes = include_bytes!("../../../target/deploy/onleash.so");
    svm.add_program(program_id, bytes).unwrap();

    // LiteSVM clock defaults to 0 — set explicitly so Clock::get works in program.
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = TEST_TIMESTAMP;
    svm.set_sysvar::<Clock>(&clock);

    let owner = Keypair::new();
    let delegate = Keypair::new();
    let mint_authority = Keypair::new();

    svm.airdrop(&owner.pubkey(), 10 * 1_000_000_000).unwrap();
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000).unwrap();

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

    svm.send_transaction(tx)
        .expect("initialize_budget should succeed");

    let budget_account = svm
        .get_account(&agent_budget)
        .expect("agent_budget account should exist");
    let budget =
        onleash::state::AgentBudget::try_deserialize(&mut budget_account.data.as_slice())
            .expect("AgentBudget should deserialize");

    assert_eq!(budget.owner, owner.pubkey());
    assert_eq!(budget.delegate, delegate.pubkey());
    assert_eq!(budget.mint, mint);
    assert_eq!(budget.total_allowance, TOTAL_ALLOWANCE);
    assert_eq!(budget.spent_total, 0);
    assert_eq!(budget.per_tx_limit, PER_TX_LIMIT);
    assert_eq!(budget.daily_limit, DAILY_LIMIT);
    assert_eq!(budget.daily_spent, 0);
    assert_eq!(budget.daily_reset_at, TEST_TIMESTAMP + 86_400);
    assert_eq!(budget.expires_at, TEST_TIMESTAMP + DURATION_SECONDS);
    assert!(!budget.paused);
    assert_eq!(budget.nonce, 0);

    let budget_ata_account = svm
        .get_account(&budget_ata)
        .expect("budget_ata should exist");
    let budget_token = TokenAccount::try_deserialize(&mut budget_ata_account.data.as_slice())
        .expect("TokenAccount should deserialize");
    assert_eq!(budget_token.amount, DEPOSIT_AMOUNT);
}
