mod common;

use common::*;

#[test]
fn paused_blocks_execute_payment() {
    let mut ctx = setup_funded_budget();

    update_policy(&mut ctx, None, None, Some(true), None).expect("pause should succeed");
    assert!(budget_state(&ctx.svm, &ctx.agent_budget).paused);

    let err = execute_payment(&mut ctx, 1_000_000).expect_err("paused budget rejects");
    assert_error_contains(&err, "BudgetPaused");
}

#[test]
fn unpause_restores_payments() {
    let mut ctx = setup_funded_budget();

    update_policy(&mut ctx, None, None, Some(true), None).unwrap();
    update_policy(&mut ctx, None, None, Some(false), None).unwrap();

    execute_payment(&mut ctx, 1_000_000).expect("unpaused should succeed");
}

#[test]
fn update_limits() {
    let mut ctx = setup_funded_budget();

    update_policy(&mut ctx, Some(10_000_000), Some(60_000_000), None, None)
        .expect("update should succeed");

    let state = budget_state(&ctx.svm, &ctx.agent_budget);
    assert_eq!(state.per_tx_limit, 10_000_000);
    assert_eq!(state.daily_limit, 60_000_000);
}
