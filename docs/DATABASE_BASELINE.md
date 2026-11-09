# ExtraChef — Database Baseline

**Read-only verification of the Supabase project — 2026-11-09**

## Executive result

**✅ Supabase API access confirmed.** The configured project URL was reachable, and authenticated `GET` requests to the Supabase REST and Storage APIs succeeded. No database rows were queried. No migration, write request, or data change was performed.

**⚠ The live PostgreSQL catalog was not accessible through the available credentials.** The API's OpenAPI document confirms which relations and RPC endpoints are exposed through PostgREST, and the Storage API confirms bucket metadata. This is not a complete database inventory: it cannot establish the live definitions or counts of tables versus views, indexes, triggers, RLS policies, grants, or non-exposed functions. There was no direct database URL/password, Management API access token, Supabase CLI, project `config.toml`, or configured Supabase MCP server available in the checkout.

**❌ The database is not reproducible from this repository alone.** The 55 checked-in migrations do not create the foundational `public.users`, `public.jobs`, or `public.applications` tables. The live API does expose all three, confirming that they exist as API resources in the connected project, but their creation source and full definitions remain unknown.

## Access and method

| Check | Result | Evidence |
|---|---|---|
| Project URL and key presence | ✅ Found in `.env.local`; values intentionally omitted | Names present: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY` |
| Legacy service-role and Management API token | ❌ `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` not found | Checked local configuration and process environment; no values recorded |
| Direct database credentials | ❌ No `DATABASE_URL` or `SUPABASE_DB_PASSWORD` found | Local configuration/process environment check |
| Supabase project configuration/tools | ❌ No `supabase/config.toml`, root `.mcp.json`, or `supabase` CLI found | Repository/tool availability check |
| Unauthenticated health check | ⚠ HTTP `401` | `GET /auth/v1/health`; endpoint responded and requires authentication |
| Authenticated REST schema | ✅ HTTP `200` | Read-only `GET /rest/v1/` with `Accept: application/openapi+json`; OpenAPI reports PostgREST `14.18` |
| Authenticated Storage bucket list | ✅ HTTP `200` | Read-only `GET /storage/v1/bucket` |
| Writes/migrations | ✅ None performed | All requests in this discovery were `GET`; no migration was run |

The key in `.env.local` is named `SUPABASE_SECRET_KEY`; it is not evidence that a legacy `service_role` JWT, a Management API token, or direct PostgreSQL credentials are available. Secret values, URL values, project reference, and user data are deliberately excluded from this document.

## Live PostgREST inventory

The following are **29 relation endpoints exposed by the live REST schema**, not a verified list of 29 base tables. PostgREST's OpenAPI description alone does not reliably distinguish a table from a view or other exposed relation.

`applications`, `checkin_attempts`, `checkins`, `checkouts`, `demand_events`, `demand_invitations`, `demand_reserves`, `events`, `geocoding_cache`, `geocoding_requests`, `jobs`, `legal_acceptances`, `messages`, `notification_preferences`, `notifications`, `operational_assignments`, `operational_codes`, `profiles`, `public_user_directory`, `push_deliveries`, `push_subscriptions`, `restaurant_profiles`, `reviews`, `talent_connections`, `todos`, `users`, `work_locations`, `worker_profiles`.

The API also exposes **89 RPC endpoint names**. This list describes exposed RPCs only; it is not a complete catalog of PostgreSQL functions.

```text
accept_current_legal_documents, account_is_active, acquire_geocoding_request,
anonymize_account, anonymize_account_before_demands, anonymize_before_control_center,
apply_work_location_geocode, approve_application, approve_application_atomic,
approve_demand_candidate, approve_single_application, archive_restaurant_demand,
can_create_review, can_create_review_with_participants, can_create_review_with_worker,
can_read_chat_profile_photo, can_request_account_deletion, confirm_work_location,
create_restaurant_demand, create_restaurant_job, demand_talent_directory,
demand_talent_directory_before_trust, ensure_account_profile,
export_account_before_control_center, export_account_before_demands,
export_account_before_operational_trust, export_own_account_data,
get_approved_chat_context, get_chat_message_preview, get_restaurant_dashboard_stats,
get_review_context, get_review_context_with_participants, get_review_context_with_worker,
get_visible_profile, get_worker_checkin_context, get_worker_checkout_context,
get_worker_dashboard_stats, interrupt_operational_assignment, invite_demand_worker,
is_approved_chat_participant, is_checkin_participant, is_checkout_participant,
is_review_participant, is_valid_cnpj, is_valid_cpf, issue_operational_code,
manage_restaurant_demand, manage_restaurant_demand_before_recruitment,
manage_work_location, mark_chat_messages_read, may_view_profile_media,
may_view_profile_media_before_demands, normalize_geocoding_field, operational_context,
operational_end, operational_location_ready, operational_start, participant_assignment,
pending_operational_reviews, process_operational_schedule, record_demand_event,
record_operational_payment, record_push_delivery, record_work_location_geocoding_failure,
recruitment_available, recruitment_blocked, recruitment_closes_at, recruitment_hireable,
register_worker_checkin, register_worker_checkout, release_geocoding_request,
request_push_test, respond_demand_invitation, restaurant_operational_message_inbox,
restaurant_talent_directory, restaurant_talent_history, restaurant_talent_reviews,
rls_auto_enable, save_geocoded_work_location, save_restaurant_event,
save_restaurant_location, save_work_location, set_demand_reserve, set_talent_connection,
update_own_profile_summary, validate_operational_code, worker_demand_invites,
worker_has_applied_for_job, worker_operational_reputation
```

### Storage buckets

| Bucket | Live visibility | Live size limit | Live allowed MIME types | Comparison with migration history |
|---|---:|---:|---|---|
| `worker-private` | Private | 10,485,760 bytes | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | ✅ Matches the bucket visibility and listed constraints in `20261014050000_profiles_and_geo.sql` |
| `restaurant-assets` | **Private** | 10,485,760 bytes | `image/jpeg`, `image/png`, `image/webp` | ⚠ **Confirmed difference:** migration `20261014050000_profiles_and_geo.sql` sets `public = true` (lines 184–185), while the live Storage API reports `public = false` |

The same migration defines `restaurant_assets_public_read` for `anon` and `authenticated` on `storage.objects` (around lines 191–205). The private live bucket flag and that policy are separate controls; the current effective access behavior was not tested. Confirm whether the live private setting is intentional before relying on public restaurant-media URLs. No objects/files were listed or downloaded.

## Comparison with checked-in migrations

### Confirmed and versioned

- **55 SQL migration files** are present under `supabase/migrations/`.
- The migrations contain DDL for application-domain objects, including `worker_profiles`, `restaurant_profiles`, `messages`, `checkins`, `checkouts`, `reviews`, `notifications`, `push_subscriptions`, `notification_preferences`, `push_deliveries`, `events`, `work_locations`, `privacy_preferences`, `legal_acceptances`, `demand_reserves`, `demand_events`, `talent_connections`, `demand_invitations`, `operational_assignments`, `operational_codes`, `geocoding_cache`, `geocoding_requests`, `work_location_evidence`, and `checkin_attempts`.
- `public_user_directory` is defined/redefined by migrations, including `20261103000000_verified_profile.sql`.
- `20261014050000_profiles_and_geo.sql` defines the Storage buckets and several `storage.objects` policies.
- `20261103000000_verified_profile.sql` defines the worker-verification trigger/function and restrictive Storage policies protecting submitted selfies.

The source search found declarations rather than a canonical, deduplicated catalog: migrations contain repeated/reconciled object definitions. Raw declaration counts (24 `CREATE TABLE`, 3 `CREATE VIEW`, 185 `CREATE FUNCTION`, 36 `CREATE TRIGGER`, 35 `CREATE INDEX`, and 86 `CREATE POLICY` statements) must **not** be interpreted as unique objects or live object counts.

### Confirmed gaps and differences

| Object/fact | Status | Evidence and impact |
|---|---|---|
| Live API exposes `/users`, `/jobs`, `/applications` | ✅ Confirmed in connected project | Present in the authenticated PostgREST OpenAPI description |
| Migrations create the three foundational tables | ❌ Not found | No `CREATE TABLE` for `public.users`, `public.jobs`, or `public.applications` in the 55 checked-in migrations; later files already alter/use them (for example `20261014051000_core_rls.sql`) |
| Origin/full schema of those tables | ❌ Unknown | API discovery confirms exposed relations, not columns, constraints, ownership, or whether the source was a missing migration, manual SQL, dump, or another project |
| Live `restaurant-assets` bucket visibility | ⚠ Diverges from migration declaration | Migration sets public; Storage API reports private. Whether this is intentional or affects product behavior needs confirmation |
| Live presence of `profiles` and `todos` | ✅ API endpoints confirmed; ⚠ backing object types/DDL unknown | Present in OpenAPI; no base-table creation was found for these names in the migration DDL scan |
| Live `work_location_evidence` relation | ⚠ Not exposed in REST OpenAPI | A migration creates it, but absence from the Data API schema does not prove that the database object is absent; it may be deliberately unexposed |
| Live indexes, triggers, RLS/storage policies, grants, and owners | ❌ Not inventoried | The available REST/Storage APIs do not expose the PostgreSQL catalogs needed to verify their deployed definitions |
| Migration application history and environment drift | ❌ Unknown | No database catalog or `supabase_migrations.schema_migrations` history was available |

### Local environment/configuration inventory

`.env.local` exists. `.env`, `.env.production`, `.env.development`, and `.env.test` were not found. The local `supabase/` directory contains `.temp/`, `diagnostics/`, `migrations/`, `proposals/`, and `tests/`; there is no checked-in baseline or declarative `supabase/schemas/` directory identified in this check. A local `.temp/project-ref` file exists, but its value is intentionally not recorded here.

## Required follow-up to close the baseline

The current result is an **API-accessible, catalog-incomplete baseline**, not a complete remote database snapshot. To classify all database objects as versioned, divergent, or absent, obtain authorized read-only access to the PostgreSQL catalogs (or an equivalent schema-only export) and the migration history for the same project/environment. Then compare relation definitions, functions and signatures, triggers, indexes, RLS and Storage policies, grants, bucket configuration, and applied migration versions. Do not infer that a live object is absent merely because it is not exposed through PostgREST.

Until that comparison is done:

- treat the live REST inventory and bucket settings above as confirmed observations;
- treat migration files as the versioned source history, not proof of the deployed state;
- treat all live catalog details not returned by the APIs as unknown;
- do not run migrations or alter the remote bucket while the `restaurant-assets` difference remains unexplained.
