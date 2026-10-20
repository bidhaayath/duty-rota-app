-- ─────────────── November roster promotion ───────────────
-- 50% off annual, 20% off monthly, all plans, until the end of
-- 31 October 2026 Maldives time (ends_at = 2026-11-01 00:00 +05).
-- One discounted payment per account per billing cycle: only a PAID payment
-- that carried a promotion uses that cycle's offer up. Abandoned, failed or
-- cancelled checkouts don't.
--
-- Both promotions are created switched OFF. Switch them on once the code is live:
--   update public.promotions set active = true
--    where name in ('November roster: 50% off annual', 'November roster: 20% off monthly');
--
-- Rollback: sql/annual_promo_rollback.sql

begin;

-- 1. Promotions table -------------------------------------------------------
create table public.promotions (
  id            bigint generated always as identity primary key,
  name          text not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  percent_off   integer not null check (percent_off between 1 and 90),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  active        boolean not null default false,
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table public.promotions enable row level security;
revoke all on table public.promotions from anon, authenticated;
grant select on table public.promotions to authenticated;
-- Signed-in users may read promotions. No write policies: only SQL / the
-- service role can create or switch a promotion.
create policy promotions_read on public.promotions
  for select to authenticated using (true);

-- 1b. New payments columns --------------------------------------------------
alter table public.payments
  add column list_amount_laari integer,
  add column promotion_id      bigint references public.promotions(id),
  add column percent_off       integer;

-- 2. active_promotion: the live promotion for a billing cycle, if any -------
--    Window is [starts_at, ends_at). Zero rows when nothing is on.
create function public.active_promotion(p_billing_cycle text)
returns setof public.promotions
language sql
stable
set search_path to 'public'
as $$
  select *
    from public.promotions
   where active
     and billing_cycle = p_billing_cycle
     and now() >= starts_at
     and now() <  ends_at
   order by percent_off desc, id
   limit 1
$$;

-- 3. promo_price: list price less percent_off, to the nearest laari / cent --
create function public.promo_price(p_list integer, p_percent_off integer)
returns integer
language sql
immutable
as $$
  select case
           when p_list is null or p_percent_off is null then p_list
           else ((p_list::bigint * (100 - p_percent_off) + 50) / 100)::integer
         end
$$;

-- 4. plan_prices: what the plans page shows, per tier -----------------------
--    *_list_* = normal price. monthly_laari / annual_laari (and the usd
--    versions) = what THIS account would pay now: the offer price if that
--    cycle's promotion is on and the account has not used that cycle's offer,
--    otherwise the list price. *_percent_off / *_ends_at describe the live
--    promotion (null when none). *_offer_used = this account already has a
--    paid discounted payment on that cycle. server_now lets the countdown
--    correct for a wrong device clock.
--    Security definer so it can read the promotions and the caller's payments
--    without depending on RLS; it only ever looks at auth.uid()'s own rows.
create function public.plan_prices()
returns table (
  tier                   text,
  monthly_list_laari     integer,
  monthly_laari          integer,
  monthly_list_usd_cents integer,
  monthly_usd_cents      integer,
  monthly_percent_off    integer,
  monthly_ends_at        timestamptz,
  monthly_offer_used     boolean,
  annual_list_laari      integer,
  annual_laari           integer,
  annual_list_usd_cents  integer,
  annual_usd_cents       integer,
  annual_percent_off     integer,
  annual_ends_at         timestamptz,
  annual_offer_used      boolean,
  server_now             timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with used as (
    select
      exists (
        select 1 from public.payments p
         where p.user_id = auth.uid()
           and p.status = 'paid'
           and p.promotion_id is not null
           and p.billing_cycle = 'monthly'
      ) as monthly,
      exists (
        select 1 from public.payments p
         where p.user_id = auth.uid()
           and p.status = 'paid'
           and p.promotion_id is not null
           and p.billing_cycle = 'annual'
      ) as annual
  )
  select pl.tier,
         pl.price_monthly_laari,
         case when e.monthly_ok then public.promo_price(pl.price_monthly_laari, m.percent_off)
              else pl.price_monthly_laari end,
         pl.price_monthly_usd_cents,
         case when e.monthly_ok then public.promo_price(pl.price_monthly_usd_cents, m.percent_off)
              else pl.price_monthly_usd_cents end,
         m.percent_off,
         m.ends_at,
         u.monthly,
         pl.price_annual_laari,
         case when e.annual_ok then public.promo_price(pl.price_annual_laari, a.percent_off)
              else pl.price_annual_laari end,
         pl.price_annual_usd_cents,
         case when e.annual_ok then public.promo_price(pl.price_annual_usd_cents, a.percent_off)
              else pl.price_annual_usd_cents end,
         a.percent_off,
         a.ends_at,
         u.annual,
         now()
    from public.plan_limits pl
   cross join used u
    left join lateral public.active_promotion('monthly') m on true
    left join lateral public.active_promotion('annual')  a on true
   cross join lateral (
     select (not u.monthly and pl.tier = any(array['basic','standard','plus','pro'])) as monthly_ok,
            (not u.annual  and pl.tier = any(array['basic','standard','plus','pro'])) as annual_ok
   ) e
   order by pl.rank
$$;

revoke execute on function public.active_promotion(text)          from public, anon;
revoke execute on function public.promo_price(integer, integer)   from public, anon;
revoke execute on function public.plan_prices()                   from public, anon;
grant  execute on function public.active_promotion(text)          to authenticated;
grant  execute on function public.promo_price(integer, integer)   to authenticated;
grant  execute on function public.plan_prices()                   to authenticated;

-- 6. bml_start_payment: decides the discounted price ------------------------
CREATE OR REPLACE FUNCTION public.bml_start_payment(p_user_id uuid, p_tier text, p_billing_cycle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tiers    constant text[] := array['basic','standard','plus','pro'];
  v_sub      public.subscriptions%rowtype;
  v_amount   int;
  v_list     int;
  v_used     boolean;
  v_promo    public.promotions%rowtype;
  v_local_id text;
begin
  if not (p_tier = any(v_tiers)) or p_billing_cycle not in ('monthly','annual') then
    return jsonb_build_object('ok', false, 'reason', 'bad_tier_or_cycle');
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'no_such_user');
  end if;

  -- Downgrades wait until the paid period is over.
  select * into v_sub from public.subscriptions where user_id = p_user_id;
  if found
     and v_sub.paid_until >= current_date
     and v_sub.plan = any(v_tiers)
     and array_position(v_tiers, p_tier) < array_position(v_tiers, v_sub.plan) then
    return jsonb_build_object(
      'ok', false, 'reason', 'downgrade_wait',
      'current_plan', v_sub.plan, 'paid_until', v_sub.paid_until);
  end if;

  select case when p_billing_cycle = 'annual'
              then price_annual_laari else price_monthly_laari end
    into v_amount
  from public.plan_limits where tier = p_tier;

  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_price');
  end if;

  -- Promotion. One discounted payment per account per billing cycle: only a
  -- PAID payment on this cycle that carried a promotion uses the offer up.
  -- The discount is for this payment only; later renewals on the same cycle
  -- see the paid one and pay the list price.
  v_list := v_amount;
  select exists (
    select 1 from public.payments
     where user_id = p_user_id
       and status = 'paid'
       and promotion_id is not null
       and billing_cycle = p_billing_cycle
  ) into v_used;

  if not v_used then
    select * into v_promo from public.active_promotion(p_billing_cycle);
    if v_promo.id is not null then
      v_amount := public.promo_price(v_list, v_promo.percent_off);
    end if;
  end if;

  v_local_id := 'BML-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-'
                || left(replace(gen_random_uuid()::text, '-', ''), 12);

  insert into public.payments
    (user_id, provider, local_id, amount_laari, tier, billing_cycle, status,
     list_amount_laari, promotion_id, percent_off)
  values
    (p_user_id, 'bml', v_local_id, v_amount, p_tier, p_billing_cycle, 'pending',
     v_list, v_promo.id, v_promo.percent_off);

  return jsonb_build_object(
    'ok', true, 'local_id', v_local_id,
    'amount_laari', v_amount, 'currency', 'MVR',
    'list_amount_laari', v_list,
    'promotion_id', v_promo.id,
    'percent_off', v_promo.percent_off,
    'offer_used', v_used);
end;
$function$;

-- 7. bml_confirm_payment: unchanged except v_new_daily (plan-change branch) --
--    uses the list price, so a discounted upgrade doesn't get double the extra days.
CREATE OR REPLACE FUNCTION public.bml_confirm_payment(p_local_id text, p_provider_txn_id text, p_amount_laari integer, p_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tiers      constant text[] := array['basic','standard','plus','pro'];
  v_pay        public.payments%rowtype;
  v_sub        public.subscriptions%rowtype;
  v_interval   interval;
  v_days_left  int := 0;
  v_old_price  int;
  v_old_daily  numeric;
  v_new_daily  numeric;
  v_extra_days int := 0;
  v_new_until  date;
  v_kind       text;
begin
  -- Lock the payment row so two confirmations can't run at once.
  select * into v_pay from public.payments
   where local_id = p_local_id and provider = 'bml'
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_pay.status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'user_id', v_pay.user_id);
  end if;

  if v_pay.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_pay.status);
  end if;

  if p_amount_laari is distinct from v_pay.amount_laari then
    update public.payments
       set raw_payload = p_payload, provider_txn_id = p_provider_txn_id
     where id = v_pay.id;
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  v_interval := case v_pay.billing_cycle
                  when 'annual' then interval '1 year'
                  else               interval '1 month'
                end;

  select * into v_sub from public.subscriptions
   where user_id = v_pay.user_id
   for update;

  if found and v_sub.paid_until is not null and v_sub.paid_until > current_date then
    v_days_left := v_sub.paid_until - current_date;
  end if;

  if v_days_left = 0
     or v_sub.plan is null
     or not (v_sub.plan = any(v_tiers))
     or v_sub.plan = v_pay.tier then
    -- New customer, expired, or same plan: add the period on.
    v_kind := case when v_days_left > 0 then 'renew' else 'new_period' end;
    v_new_until := (greatest(coalesce(v_sub.paid_until, current_date), current_date)
                    + v_interval)::date;
  else
    -- Plan change with time left: convert leftover value into days.
    select case when coalesce(v_sub.billing_cycle, 'monthly') = 'annual'
                then price_annual_laari else price_monthly_laari end
      into v_old_price
    from public.plan_limits where tier = v_sub.plan;

    v_old_daily := v_old_price
                   / case when coalesce(v_sub.billing_cycle, 'monthly') = 'annual'
                          then 365.0 else 30.0 end;
    v_new_daily := coalesce(v_pay.list_amount_laari, v_pay.amount_laari)
                   / case when v_pay.billing_cycle = 'annual' then 365.0 else 30.0 end;

    v_extra_days := coalesce(floor((v_days_left * v_old_daily) / v_new_daily), 0);
    v_new_until  := (current_date + v_interval)::date + v_extra_days;
    v_kind := case
                when array_position(v_tiers, v_pay.tier) > array_position(v_tiers, v_sub.plan)
                then 'upgrade' else 'downgrade'
              end;
  end if;

  update public.payments
     set status          = 'paid',
         paid_at         = now(),
         provider_txn_id = p_provider_txn_id,
         raw_payload     = coalesce(p_payload, '{}'::jsonb)
                           || jsonb_build_object('kind', v_kind, 'extra_days', v_extra_days)
   where id = v_pay.id;

  insert into public.subscriptions as s
    (user_id, plan, billing_cycle, paid_until, provider, provider_ref, notes, status)
  values
    (v_pay.user_id, v_pay.tier, v_pay.billing_cycle, v_new_until,
     'bml', p_provider_txn_id, 'BML payment ' || p_local_id, 'active')
  on conflict (user_id) do update
    set plan          = excluded.plan,
        billing_cycle = excluded.billing_cycle,
        paid_until    = excluded.paid_until,
        provider      = 'bml',
        provider_ref  = excluded.provider_ref,
        notes         = excluded.notes,
        status        = 'active';

  return jsonb_build_object(
    'ok', true, 'user_id', v_pay.user_id, 'kind', v_kind,
    'paid_until', v_new_until, 'extra_days', v_extra_days);
end;
$function$;

-- 8. The two promotions, switched OFF ----------------------------------------
insert into public.promotions (name, billing_cycle, percent_off, starts_at, ends_at, active)
values
  ('November roster: 50% off annual',  'annual',  50, now(), timestamptz '2026-11-01 00:00:00+05', false),
  ('November roster: 20% off monthly', 'monthly', 20, now(), timestamptz '2026-11-01 00:00:00+05', false);

commit;
