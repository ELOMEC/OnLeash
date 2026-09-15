mod common;

use common::*;

#[test]
fn happy_path_close_budget() {
    let mut ctx = setup_funded_budget();

    let agent_budget_key = ctx.agent_budget;
    let budget_ata_key = ctx.budget_ata;
    let owner_ata_key = ctx.owner_ata;
    let before_owner_balance = token_amount(&ctx.svm, &owner_ata_key);

    close_budget(&mut ctx).expect("close should succeed");

    // PDA closed (lamports zeroed)
    assert_eq!(account_lamports(&ctx.svm, &agent_budget_key), 0);

    // budget_ata closed (lamports zeroed)
    assert_eq!(account_lamports(&ctx.svm, &budget_ata_key), 0);

    // Owner refunded the full deposit
    let after_owner_balance = token_amount(&ctx.svm, &owner_ata_key);
    assert_eq!(after_owner_balance, before_owner_balance + DEPOSIT_AMOUNT);
}
