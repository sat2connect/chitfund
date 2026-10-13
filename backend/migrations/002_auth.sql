-- Self-managed authentication: credentials, MFA, server-side sessions and login challenges.
-- Secrets are never stored in the clear: passwords use scrypt hashes, session tokens and activation codes
-- are stored as SHA-256 digests, and TOTP secrets are encrypted with a key held outside the database.

create table user_credentials (
  user_id text primary key references users (id) deferrable initially deferred,
  username text not null,
  password_hash text,
  password_changed_at timestamptz,
  must_change_password boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  mfa_enabled boolean not null default false,
  mfa_secret_enc text,
  mfa_last_step bigint,
  recovery_codes jsonb not null default '[]'::jsonb,
  activation_hash text,
  activation_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (username = lower(username) and length(username) between 3 and 120)
);
create unique index user_credentials_username on user_credentials (username);
create unique index user_credentials_activation on user_credentials (activation_hash) where activation_hash is not null;

create table sessions (
  id text primary key,                 -- SHA-256 of the session token; the token itself is never stored
  user_id text not null references users (id) deferrable initially deferred,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,     -- absolute lifetime
  revoked_at timestamptz,
  ip text,
  user_agent text
);
create index sessions_user on sessions (user_id) where revoked_at is null;

-- A password check that still needs a second step (MFA code or MFA enrolment) before a session exists.
create table login_challenges (
  id text primary key,                 -- SHA-256 of the challenge token
  user_id text not null references users (id) deferrable initially deferred,
  purpose text not null check (purpose in ('MFA_VERIFY', 'MFA_ENROLL')),
  pending_secret_enc text,
  attempts integer not null default 0,
  consumed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
