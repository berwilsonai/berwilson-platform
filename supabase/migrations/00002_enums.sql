-- 00002_enums.sql
-- All application enum types

create type project_sector as enum ('government','infrastructure','real_estate','prefab','institutional');
create type project_status as enum ('active','on_hold','won','lost','closed');
create type project_stage as enum ('pursuit','capture','bid','award','mobilization','execution','closeout');
create type update_source as enum ('email','manual_paste','document','agent','procore');
create type review_state as enum ('pending','approved','rejected');
create type dd_severity as enum ('info','watch','critical','blocker');
create type compliance_status as enum ('not_started','in_progress','compliant','non_compliant','waived');
create type entity_type as enum ('llc','corp','jv','subsidiary','trust','fund','other');
