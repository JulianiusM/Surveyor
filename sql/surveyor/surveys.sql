create or replace table surveys
(
    id         char(36)  default uuid()              not null
        primary key,
    creator_id int                                   null,
    title      varchar(255)                          not null,
    created_at timestamp default current_timestamp() not null,
    updated_at timestamp default current_timestamp() not null on update current_timestamp(),
    constraint surveys_users_id_fk
        foreign key (creator_id) references users (id)
            on update cascade on delete cascade
);

