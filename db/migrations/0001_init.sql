-- Записи галерей и проектов: одна строка на запись любого инструмента,
-- тело записи целиком в data (jsonb). owner_id — владелец рабочего
-- пространства (пока один: 'owner'); аккаунты добавятся без смены схемы.
create table if not exists records (
  id          text primary key,
  owner_id    text not null,
  collection  text not null,
  data        jsonb not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null default now()
);

create index if not exists records_owner_collection_idx
  on records (owner_id, collection, created_at desc);

-- Учёт объектов в хранилище (R2/диск): ключ тот же, что у блоба в IndexedDB
-- клиента (`${id}:${role}`), record_id — запись, которой объект принадлежит.
create table if not exists assets (
  owner_id      text not null,
  key           text not null,
  record_id     text not null,
  content_type  text not null,
  bytes         integer not null,
  created_at    timestamptz not null default now(),
  primary key (owner_id, key)
);

create index if not exists assets_owner_record_idx
  on assets (owner_id, record_id);
