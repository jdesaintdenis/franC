-- The official postgres image only lets POSTGRES_DB provision one database
-- on first boot. Create the second (test) database alongside it, owned by
-- the same app user, so dev and test data never mix.
CREATE DATABASE franc_test OWNER "franc";
