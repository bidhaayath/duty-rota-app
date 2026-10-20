-- ─────────────── Rollback: November roster promotion ───────────────
-- Quick off switch (no deploy, keeps every record). Use this first:
--   update public.promotions set active = false
--    where name in ('November roster: 50% off annual', 'November roster: 20% off monthly');
--
-- Full removal below. Revert the code deploy BEFORE running it, because the
-- plans page calls plan_prices().
-- WARNING: dropping the payments columns loses the record of which payments
-- were discounted. If any promotion payment has been paid, prefer the off switch.
--   select count(*) from public.payments where promotion_id is not null and status = 'paid';

begin;

-- 1. Both payment functions restored exactly as they were (query B) ---------
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

  v_local_id := 'BML-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-'
                || left(replace(gen_random_uuid()::text, '-', ''), 12);

  insert into public.payments
    (user_id, provider, local_id, amount_laari, tier, billing_cycle, status)
  values
    (p_user_id, 'bml', v_local_id, v_amount, p_tier, p_billing_cycle, 'pending');

  return jsonb_build_object(
    'ok', true, 'local_id', v_local_id,
    'amount_laari', v_amount, 'currency', 'MVR');
end;
$function$;

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
    v_new_daily := v_pay.amount_laari
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

-- 2. Remove the promotion objects (functions first, then columns, then table)
drop function if exists public.plan_prices();
drop function if exists public.active_promotion(text);
drop function if exists public.promo_price(integer, integer);

alter table public.payments
  drop column if exists promotion_id,
  drop column if exists percent_off,
  drop column if exists list_amount_laari;

drop table if exists public.promotions;

commit;
