use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::error::OnleashError;
use crate::state::AgentBudget;

#[derive(Accounts)]
pub struct TopUp<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ OnleashError::OwnerMismatch,
        has_one = mint @ OnleashError::MintMismatch,
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
        mut,
        associated_token::mint = mint,
        associated_token::authority = agent_budget,
    )]
    pub budget_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_top_up(ctx: Context<TopUp>, amount: u64) -> Result<()> {
    require!(amount > 0, OnleashError::InvalidDeposit);

    let budget = &mut ctx.accounts.agent_budget;
    budget.total_allowance = budget
        .total_allowance
        .checked_add(amount)
        .ok_or(OnleashError::Overflow)?;

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
    transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    Ok(())
}
