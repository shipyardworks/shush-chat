# Shush — database schema

<!--
  GENERATED FILE — do not edit by hand.

  Written by SchemaDocIT on every `cd api && ./mvnw verify`, by reading a real
  Postgres after every Flyway migration has run against it. Editing this file
  changes nothing; edit a migration in api/src/main/resources/db/migration/ and
  rebuild. Migrations are forward-only: never change one that has been applied,
  add the next one.
-->

> **Generated — do not edit.** Change the schema by adding a migration under
> `api/src/main/resources/db/migration/`, then run `cd api && ./mvnw verify`.

Generated 2026-09-18 from 16 tables.

## Migrations applied

| Version | Description | Applied |
| --- | --- | --- |
| `V1` | spike records | yes |
| `V2` | drop spike records | yes |
| `V3` | initial schema | yes |
| `V4` | seed interests | yes |
| `V5` | friend request declined | yes |
| `V6` | cors origins | yes |
| `V7` | message interactions | yes |
| `V8` | custom interests | yes |
| `V9` | lowercase interest labels | yes |
| `V10` | end superseded stranger conversations | yes |

---

## Tables

### `blocks`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `blocker_id` | `uuid` | no | — |
| `blocked_id` | `uuid` | no | — |
| `created_at` | `timestamp with time zone` | no | — |

**Primary key**

- `blocks_pkey` — `PRIMARY KEY (blocker_id, blocked_id)`

**Foreign keys**

- `blocks_blocked_id_fkey` — `FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE`
- `blocks_blocker_id_fkey` — `FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE`

### `conversation_participants`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `conversation_id` | `uuid` | no | — |
| `user_id` | `uuid` | no | — |
| `read_cursor_seq` | `bigint` | no | `0` |
| `unread_count` | `integer` | no | `0` |
| `left_at` | `timestamp with time zone` | yes | — |

**Primary key**

- `conversation_participants_pkey` — `PRIMARY KEY (conversation_id, user_id)`

**Foreign keys**

- `conversation_participants_conversation_id_fkey` — `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE`
- `conversation_participants_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`

**Indexes**

- `conversation_participants_user_idx` — `CREATE INDEX conversation_participants_user_idx ON public.conversation_participants USING btree (user_id)`

### `conversations`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | no | — |
| `kind` | `text` | no | — |
| `state` | `text` | no | — |
| `matched_on` | `smallint[]` | yes | — |
| `last_seq` | `bigint` | no | `0` |
| `created_at` | `timestamp with time zone` | no | — |
| `ended_at` | `timestamp with time zone` | yes | — |
| `purge_after` | `timestamp with time zone` | yes | — |

**Primary key**

- `conversations_pkey` — `PRIMARY KEY (id)`

**Checks**

- `conversations_kind_check` — `CHECK ((kind = ANY (ARRAY['stranger'::text, 'friend'::text])))`
- `conversations_state_check` — `CHECK ((state = ANY (ARRAY['active'::text, 'ended'::text, 'kept'::text])))`

**Indexes**

- `conversations_purge_after_idx` — `CREATE INDEX conversations_purge_after_idx ON public.conversations USING btree (purge_after) WHERE (purge_after IS NOT NULL)`

### `cors_origins`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `origin` | `text` | no | — |
| `note` | `text` | yes | — |
| `created_at` | `timestamp with time zone` | no | `now()` |

**Primary key**

- `cors_origins_pkey` — `PRIMARY KEY (origin)`

### `device_tokens`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `token_hash` | `text` | no | — |
| `user_id` | `uuid` | no | — |
| `created_at` | `timestamp with time zone` | no | — |
| `last_used_at` | `timestamp with time zone` | no | — |

**Primary key**

- `device_tokens_pkey` — `PRIMARY KEY (token_hash)`

**Foreign keys**

- `device_tokens_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`

**Indexes**

- `device_tokens_user_idx` — `CREATE INDEX device_tokens_user_idx ON public.device_tokens USING btree (user_id)`

### `friend_requests`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | no | — |
| `conversation_id` | `uuid` | no | — |
| `from_user_id` | `uuid` | no | — |
| `to_user_id` | `uuid` | no | — |
| `status` | `text` | no | — |
| `created_at` | `timestamp with time zone` | no | — |
| `expires_at` | `timestamp with time zone` | no | — |

**Primary key**

- `friend_requests_pkey` — `PRIMARY KEY (id)`

**Foreign keys**

- `friend_requests_conversation_id_fkey` — `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE`
- `friend_requests_from_user_id_fkey` — `FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE`
- `friend_requests_to_user_id_fkey` — `FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE`

**Unique**

- `friend_requests_conversation_from_user_key` — `UNIQUE (conversation_id, from_user_id)`

**Checks**

- `friend_requests_status_check` — `CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text])))`

**Indexes**

- `friend_requests_expires_at_idx` — `CREATE INDEX friend_requests_expires_at_idx ON public.friend_requests USING btree (expires_at) WHERE (status = 'pending'::text)`
- `friend_requests_to_user_status_idx` — `CREATE INDEX friend_requests_to_user_status_idx ON public.friend_requests USING btree (to_user_id, status)`

### `friendships`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `user_a_id` | `uuid` | no | — |
| `user_b_id` | `uuid` | no | — |
| `conversation_id` | `uuid` | no | — |
| `created_at` | `timestamp with time zone` | no | — |

**Primary key**

- `friendships_pkey` — `PRIMARY KEY (user_a_id, user_b_id)`

**Foreign keys**

- `friendships_conversation_id_fkey` — `FOREIGN KEY (conversation_id) REFERENCES conversations(id)`
- `friendships_user_a_id_fkey` — `FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE`
- `friendships_user_b_id_fkey` — `FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE`

**Checks**

- `friendships_ordered_check` — `CHECK ((user_a_id < user_b_id))`

**Indexes**

- `friendships_user_b_idx` — `CREATE INDEX friendships_user_b_idx ON public.friendships USING btree (user_b_id)`

### `interests`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | `smallint` | no | — |
| `slug` | `text` | no | — |
| `label` | `text` | no | — |
| `popularity` | `integer` | no | `0` |

**Primary key**

- `interests_pkey` — `PRIMARY KEY (id)`

**Unique**

- `interests_slug_key` — `UNIQUE (slug)`

**Indexes**

- `interests_popularity_idx` — `CREATE INDEX interests_popularity_idx ON public.interests USING btree (popularity DESC)`

### `invite_links`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `code` | `text` | no | — |
| `owner_id` | `uuid` | no | — |
| `created_at` | `timestamp with time zone` | no | — |
| `expires_at` | `timestamp with time zone` | no | — |

**Primary key**

- `invite_links_pkey` — `PRIMARY KEY (code)`

**Foreign keys**

- `invite_links_owner_id_fkey` — `FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE`

**Indexes**

- `invite_links_owner_idx` — `CREATE INDEX invite_links_owner_idx ON public.invite_links USING btree (owner_id)`

### `media_objects`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `key` | `text` | no | — |
| `uploader_id` | `uuid` | no | — |
| `conversation_id` | `uuid` | no | — |
| `status` | `text` | no | — |
| `mime` | `text` | no | — |
| `size_bytes` | `bigint` | yes | — |
| `created_at` | `timestamp with time zone` | no | — |
| `expires_at` | `timestamp with time zone` | no | — |

**Primary key**

- `media_objects_pkey` — `PRIMARY KEY (key)`

**Foreign keys**

- `media_objects_conversation_id_fkey` — `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE`
- `media_objects_uploader_id_fkey` — `FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE`

**Checks**

- `media_objects_status_check` — `CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text])))`

**Indexes**

- `media_objects_expires_at_idx` — `CREATE INDEX media_objects_expires_at_idx ON public.media_objects USING btree (expires_at)`
- `media_objects_status_created_at_idx` — `CREATE INDEX media_objects_status_created_at_idx ON public.media_objects USING btree (status, created_at)`

### `message_hides`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `message_id` | `uuid` | no | — |
| `user_id` | `uuid` | no | — |
| `created_at` | `timestamp with time zone` | no | — |

**Primary key**

- `message_hides_pkey` — `PRIMARY KEY (message_id, user_id)`

**Foreign keys**

- `message_hides_message_id_fkey` — `FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE`
- `message_hides_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`

### `message_reactions`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `message_id` | `uuid` | no | — |
| `user_id` | `uuid` | no | — |
| `emoji` | `text` | no | — |
| `created_at` | `timestamp with time zone` | no | — |

**Primary key**

- `message_reactions_pkey` — `PRIMARY KEY (message_id, user_id)`

**Foreign keys**

- `message_reactions_message_id_fkey` — `FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE`
- `message_reactions_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`

**Indexes**

- `message_reactions_message_idx` — `CREATE INDEX message_reactions_message_idx ON public.message_reactions USING btree (message_id)`

### `messages`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | no | — |
| `conversation_id` | `uuid` | no | — |
| `sender_id` | `uuid` | no | — |
| `seq` | `bigint` | no | — |
| `kind` | `text` | no | — |
| `body` | `text` | yes | — |
| `media_key` | `text` | yes | — |
| `client_msg_id` | `uuid` | no | — |
| `created_at` | `timestamp with time zone` | no | — |
| `reply_to_seq` | `bigint` | yes | — |
| `deleted_at` | `timestamp with time zone` | yes | — |

**Primary key**

- `messages_pkey` — `PRIMARY KEY (id)`

**Foreign keys**

- `messages_conversation_id_fkey` — `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE`
- `messages_sender_id_fkey` — `FOREIGN KEY (sender_id) REFERENCES users(id)`

**Unique**

- `messages_conversation_sender_client_msg_id_key` — `UNIQUE (conversation_id, sender_id, client_msg_id)`
- `messages_conversation_seq_key` — `UNIQUE (conversation_id, seq)`

**Checks**

- `messages_kind_check` — `CHECK ((kind = ANY (ARRAY['text'::text, 'image'::text, 'system'::text])))`
- `messages_reply_to_seq_check` — `CHECK (((reply_to_seq IS NULL) OR (reply_to_seq > 0)))`

**Indexes**

- `messages_conversation_reply_to_idx` — `CREATE INDEX messages_conversation_reply_to_idx ON public.messages USING btree (conversation_id, reply_to_seq) WHERE (reply_to_seq IS NOT NULL)`

### `reports`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | no | — |
| `reporter_id` | `uuid` | no | — |
| `reported_id` | `uuid` | no | — |
| `conversation_id` | `uuid` | yes | — |
| `reason` | `text` | no | — |
| `created_at` | `timestamp with time zone` | no | — |

**Primary key**

- `reports_pkey` — `PRIMARY KEY (id)`

**Foreign keys**

- `reports_conversation_id_fkey` — `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL`
- `reports_reported_id_fkey` — `FOREIGN KEY (reported_id) REFERENCES users(id) ON DELETE CASCADE`
- `reports_reporter_id_fkey` — `FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE`

### `user_interests`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `user_id` | `uuid` | no | — |
| `interest_id` | `smallint` | no | — |
| `last_used_at` | `timestamp with time zone` | no | — |

**Primary key**

- `user_interests_pkey` — `PRIMARY KEY (user_id, interest_id)`

**Foreign keys**

- `user_interests_interest_id_fkey` — `FOREIGN KEY (interest_id) REFERENCES interests(id)`
- `user_interests_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`

### `users`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | no | — |
| `display_name` | `text` | no | — |
| `is_anonymous` | `boolean` | no | `true` |
| `email` | `citext` | yes | — |
| `password_hash` | `text` | yes | — |
| `created_at` | `timestamp with time zone` | no | — |
| `last_seen_at` | `timestamp with time zone` | no | — |
| `deleted_at` | `timestamp with time zone` | yes | — |

**Primary key**

- `users_pkey` — `PRIMARY KEY (id)`

**Unique**

- `users_display_name_key` — `UNIQUE (display_name)`
- `users_email_key` — `UNIQUE (email)`
