create or replace table surveys
(
    id          char(36)  default uuid()              not null
        primary key,
    owner_id    int                                   null,
    title       varchar(255)                          not null,
    description TEXT                                  NULL,
    created_at  timestamp default current_timestamp() not null,
    updated_at  timestamp default current_timestamp() not null on update current_timestamp(),
    constraint surveys_users_id_fk
        foreign key (owner_id) references users (id)
            on update cascade on delete cascade
);

