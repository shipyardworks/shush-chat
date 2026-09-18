-- A new match now ends every other open stranger conversation either person had
-- (ConversationService#createMatched). Before that rule existed each match left the previous one
-- active, so this closes the ones that are already stuck open: any active stranger conversation
-- where one of its two people has since started a newer conversation. Nothing is deleted and
-- purge_after is left as it was -- this only stops them taking messages.
update conversations c
set state    = 'ended',
    ended_at = now()
where c.state = 'active'
  and c.kind = 'stranger'
  and exists (
      select 1
      from conversation_participants mine
      join conversation_participants theirs on theirs.user_id = mine.user_id
      join conversations newer on newer.id = theirs.conversation_id
      where mine.conversation_id = c.id
        and newer.id <> c.id
        and newer.created_at > c.created_at
  );
