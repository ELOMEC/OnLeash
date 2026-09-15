use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::error::OnleashError;
use crate::state::AgentBudget;

#[derive(Accounts)]
pub struct ExecutePayment<'info> {
    pub delegate: Signer<'info>,

    #[account(
        mut,
        has_one = delegate @ OnleashError::DelegateMismatch,
        has_one = mint @ OnleashError::MintMismatch,
    )]
    pub agent_budget: Box<Account<'info, AgentBudget>>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = agent_budget,
    )]
    pub budget_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
    )]
    pub recipient_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_execute_payment(ctx: Context<ExecutePayment>, amount: u64) -> Result<()> {
    require!(amount > 0, OnleashError::InvalidPaymentAmount);

    let now = Clock::get()?.unix_timestamp;
    let mint_decimals = ctx.accounts.mint.decimals;

    let (new_daily_spent, new_daily_reset_at, new_spent_total, owner_key, delegate_key, bump) = {
        let budget = &ctx.accounts.agent_budget;
        require!(!budget.paused, OnleashError::BudgetPaused);
        require!(now < budget.expires_at, OnleashError::BudgetExpired);
        require!(
            amount <= budget.per_tx_limit,
            OnleashError::PerTxLimitExceeded
        );

        let (new_daily_spent, new_daily_reset_at) = if now >= budget.daily_reset_at {
            (amount, now + 86_400)
        } else {
            (
                budget
                    .daily_spent
                    .checked_add(amount)
                    .ok_or(OnleashError::Overflow)?,
                budget.daily_reset_at,
            )
        };
        require!(
            new_daily_spent <= budget.daily_limit,
            OnleashError::DailyLimitExceeded
        );

        let new_spent_total = budget
            .spent_total
            .checked_add(amount)
            .ok_or(OnleashError::Overflow)?;
        require!(
            new_spent_total <= budget.total_allowance,
            OnleashError::AllowanceExceeded
        );

        (
            new_daily_spent,
            new_daily_reset_at,
            new_spent_total,
            budget.owner,
            budget.delegate,
            budget.bump,
        )
    };

    let signer_seeds: &[&[&[u8]]] = &[&[
        b"agent",
        owner_key.as_ref(),
        delegate_key.as_ref(),
        &[bump],
    ]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.budget_ata.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.recipient_ata.to_account_info(),
        authority: ctx.accounts.agent_budget.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    transfer_checked(cpi_ctx, amount, mint_decimals)?;

    let budget = &mut ctx.accounts.agent_budget;
    budget.spent_total = new_spent_total;
    budget.daily_spent = new_daily_spent;
    budget.daily_reset_at = new_daily_reset_at;
    budget.nonce = budget
        .nonce
        .checked_add(1)
        .ok_or(OnleashError::Overflow)?;

    Ok(())
}
