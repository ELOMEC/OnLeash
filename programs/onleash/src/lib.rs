pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6M5XU4icTbfym3y6JxNNff2sXPiJTnKfBEWJr9D6XRr");

#[program]
pub mod onleash {
    use super::*;

    pub fn initialize_budget(
        ctx: Context<InitializeBudget>,
        delegate: Pubkey,
        total_allowance: u64,
        per_tx_limit: u64,
        daily_limit: u64,
        duration_seconds: i64,
        deposit_amount: u64,
    ) -> Result<()> {
        instructions::initialize_budget::handle_initialize_budget(
            ctx,
            delegate,
            total_allowance,
            per_tx_limit,
            daily_limit,
            duration_seconds,
            deposit_amount,
        )
    }

    pub fn execute_payment(ctx: Context<ExecutePayment>, amount: u64) -> Result<()> {
        instructions::execute_payment::handle_execute_payment(ctx, amount)
    }

    pub fn top_up(ctx: Context<TopUp>, amount: u64) -> Result<()> {
        instructions::top_up::handle_top_up(ctx, amount)
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        new_per_tx_limit: Option<u64>,
        new_daily_limit: Option<u64>,
        new_paused: Option<bool>,
        new_expires_at: Option<i64>,
    ) -> Result<()> {
        instructions::update_policy::handle_update_policy(
            ctx,
            new_per_tx_limit,
            new_daily_limit,
            new_paused,
            new_expires_at,
        )
    }

    pub fn close_budget(ctx: Context<CloseBudget>) -> Result<()> {
        instructions::close_budget::handle_close_budget(ctx)
    }
}
