use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::error::OnleashError;
use crate::state::AgentBudget;

#[derive(Accounts)]
#[instruction(delegate: Pubkey)]
pub struct InitializeBudget<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentBudget::INIT_SPACE,
        seeds = [b"agent", owner.key().as_ref(), delegate.as_ref()],
        bump
    )]
    pub agent_budget: Box<Account<'info, AgentBudget>>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub owner_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = agent_budget,
    )]
    pub budget_ata: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_initialize_budget(
    ctx: Context<InitializeBudget>,
    delegate: Pubkey,
    total_allowance: u64,
    per_tx_limit: u64,
    daily_limit: u64,
    duration_seconds: i64,
    deposit_amount: u64,
) -> Result<()> {
    require!(total_allowance > 0, OnleashError::InvalidAllowance);
    require!(
        per_tx_limit > 0 && per_tx_limit <= total_allowance,
        OnleashError::InvalidPerTxLimit
    );
    require!(daily_limit >= per_tx_limit, OnleashError::InvalidDailyLimit);
    require!(duration_seconds > 0, OnleashError::InvalidDuration);
    require!(deposit_amount > 0, OnleashError::InvalidDeposit);
    require!(
        deposit_amount <= total_allowance,
        OnleashError::DepositExceedsAllowance
    );

    let now = Clock::get()?.unix_timestamp;

    let budget = &mut ctx.accounts.agent_budget;
    budget.owner = ctx.accounts.owner.key();
    budget.delegate = delegate;
    budget.mint = ctx.accounts.mint.key();
    budget.total_allowance = total_allowance;
    budget.spent_total = 0;
    budget.per_tx_limit = per_tx_limit;
    budget.daily_limit = daily_limit;
    budget.daily_spent = 0;
    budget.daily_reset_at = now + 86_400;
    budget.expires_at = now + duration_seconds;
    budget.paused = false;
    budget.nonce = 0;
    budget.bump = ctx.bumps.agent_budget;

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.owner_ata.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.budget_ata.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),
        cpi_accounts,
    );
    transfer_checked(cpi_ctx, deposit_amount, ctx.accounts.mint.decimals)?;

    Ok(())
}
