-- Interest tiles read as a mismatched pair of styles -- "Movies & TV" next to "Travel" next to
-- whatever a person typed verbatim. Labels move to a single, consistent shape: one lowercase
-- word, no spaces, no punctuation. The curated rows already have exactly that sitting in `slug`
-- (aim.md 4.3's dedupe key was built to this shape from the start), so this is a rename, not a
-- new value. Only the seeded rows change -- an ad hoc tag's slug is a hyphenated dump of
-- whatever it slugified from and is not fit to display; those rows stop being shown at all as of
-- this release (see InterestController#list and SetupPanel's ticker filter), so their label is
-- left alone.
update interests set label = slug where popularity > 0;
