use anchor_lang::prelude::*;

use crate::error::OnleashError;
use crate::state::AgentBudget;

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ OnleashError::OwnerMismatch,
    )]
    pub agent_budget: Box<Account<'info, AgentBudget>>,
}

pub fn handle_update_policy(
    ctx: Context<UpdatePolicy>,
    new_per_tx_limit: Option<u64>,
    new_daily_limit: Option<u64>,
    new_paused: Option<bool>,
    new_expires_at: Option<i64>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let budget = &mut ctx.accounts.agent_budget;

    if let Some(p) = new_per_tx_limit {
        require!(p > 0, OnleashError::InvalidPerTxLimit);
        require!(
            p <= budget.total_allowance,
            OnleashError::InvalidPerTxLimit
        );
        budget.per_tx_limit = p;
    }
    if let Some(d) = new_daily_limit {
        require!(
            d >= budget.per_tx_limit,
            OnleashError::InvalidDailyLimit
        );
        budget.daily_limit = d;
    }
    if let Some(p) = new_paused {
        budget.paused = p;
    }
    if let Some(e) = new_expires_at {
        require!(e > now, OnleashError::InvalidDuration);
        budget.expires_at = e;
    }

    Ok(())
}
