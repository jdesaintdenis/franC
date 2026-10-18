-- Slice 35: the starting account was always named "Main account". Users who
-- saved French as their language get the French name, unless they already
-- have an account called that. Renamed accounts are left alone.
UPDATE accounts a
SET name = 'Compte principal'
FROM users u
WHERE u.id = a.user_id
  AND u.locale = 'fr'
  AND a.name = 'Main account'
  AND NOT EXISTS (
    SELECT 1 FROM accounts o WHERE o.user_id = a.user_id AND o.name = 'Compte principal'
  );
