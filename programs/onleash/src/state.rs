use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct AgentBudget {
    pub owner: Pubkey,
    pub delegate: Pubkey,
    pub mint: Pubkey,
    pub total_allowance: u64,
    pub spent_total: u64,
    pub per_tx_limit: u64,
    pub daily_limit: u64,
    pub daily_spent: u64,
    pub daily_reset_at: i64,
    pub expires_at: i64,
    pub paused: bool,
    pub nonce: u64,
    pub bump: u8,
}
