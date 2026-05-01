-- 00001_extensions.sql
-- Enable required Postgres extensions

create extension if not exists pgcrypto;
create extension if not exists vector;
