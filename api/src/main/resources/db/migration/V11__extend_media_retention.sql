-- Images stop expiring overnight.
--
-- `shush.storage.anonymous-retention` decided how long an image lives when it was uploaded, and
-- wrote the answer into `expires_at` on the row. Changing the setting therefore only governs the
-- next upload -- every image already in the bucket keeps the 24-hour deadline it was stamped
-- with, and the sweep goes on deleting them on yesterday's rule. Which is the whole complaint:
-- a photo sent this afternoon would still be gone by tomorrow, with the setting apparently
-- changed and nothing to show for it.
--
-- So the rows are restamped to the new window. `created_at`, not `now()`: retention is measured
-- from when the image was uploaded, and dating it from the migration would hand a picture sent
-- three weeks ago a fresh month. Only rows that expire sooner than the new rule are touched, so
-- this can never shorten anything.
--
-- Nothing is deleted or recovered here. An image the sweep has already taken is gone from object
-- storage along with its row; this only concerns what is still there.
update media_objects
   set expires_at = created_at + interval '30 days'
 where expires_at < created_at + interval '30 days';
