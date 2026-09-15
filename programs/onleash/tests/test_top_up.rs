mod common;

use common::*;

#[test]
fn happy_path_top_up() {
    let mut ctx = setup_funded_budget();

    let top_up_amount = 50_000_000; // 50 USDC

    let before_state = budget_state(&ctx.svm, &ctx.agent_budget);
    let before_budget_balance = token_amount(&ctx.svm, &ctx.budget_ata);
    let before_owner_balance = token_amount(&ctx.svm, &ctx.owner_ata);

    top_up(&mut ctx, top_up_amount).expect("top_up should succeed");

    let after_state = budget_state(&ctx.svm, &ctx.agent_budget);
    assert_eq!(
        after_state.total_allowance,
        before_state.total_allowance + top_up_amount
    );
    assert_eq!(
        token_amount(&ctx.svm, &ctx.budget_ata),
        before_budget_balance + top_up_amount
    );
    assert_eq!(
        token_amount(&ctx.svm, &ctx.owner_ata),
        before_owner_balance - top_up_amount
    );
}
