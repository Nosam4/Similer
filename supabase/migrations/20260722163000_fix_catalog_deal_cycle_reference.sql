-- The original deal function used a local variable named cycle_number beside a
-- table column of the same name. Qualify the local variable in the already-live
-- function body. Fresh databases receive the corrected definition from the
-- preceding migration, making this migration a safe no-op there.

do $migration$
declare
  deal_function_definition text;
  ambiguous_reference constant text := 'usage.cycle_number = cycle_number';
  qualified_reference constant text := 'usage.cycle_number = deal_catalog_hand.cycle_number';
begin
  select pg_catalog.pg_get_functiondef(
    'public.deal_catalog_hand(uuid,integer,integer,integer[],jsonb,uuid,text,text)'::regprocedure
  )
  into deal_function_definition;

  if pg_catalog.strpos(deal_function_definition, ambiguous_reference) > 0 then
    execute pg_catalog.replace(
      deal_function_definition,
      ambiguous_reference,
      qualified_reference
    );
  end if;
end;
$migration$;
