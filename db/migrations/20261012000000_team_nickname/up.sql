-- The name a user goes by in one team. NULL means "use the default" — the IdP nickname
-- (users.nickname).
ALTER TABLE team_members ADD COLUMN nickname TEXT;
