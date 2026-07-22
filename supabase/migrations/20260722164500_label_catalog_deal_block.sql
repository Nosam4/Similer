-- PL/pgSQL local variables can be qualified through an explicit block label.
-- Add that label to the already-live function and replace the invalid implicit
-- function-name qualification introduced by the preceding hotfix. Fresh
-- databases already receive the labeled definition and make this a no-op.

do $migration$
declare
  deal_function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.deal_catalog_hand(uuid,integer,integer,integer[],jsonb,uuid,text,text)'::regprocedure
  )
  into deal_function_definition;

  if pg_catalog.strpos(deal_function_definition, 'deal_catalog_hand.cycle_number') > 0 then
    deal_function_definition := pg_catalog.replace(
      deal_function_definition,
      E'AS $function$\ndeclare',
      E'AS $function$\n<<catalog_deal>>\ndeclare'
    );
    deal_function_definition := pg_catalog.replace(
      deal_function_definition,
      'deal_catalog_hand.cycle_number',
      'catalog_deal.cycle_number'
    );

    execute deal_function_definition;
  end if;
end;
$migration$;
