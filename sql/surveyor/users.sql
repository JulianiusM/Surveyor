create or replace table users
(
    id                          int auto_increment
        primary key,
    username                    varchar(50)                            not null,
    email                       varchar(100)                           not null,
    password                    varchar(255)                           not null,
    is_active                   tinyint(1) default 0                   null,
    created_at                  timestamp  default current_timestamp() not null,
    updated_at                  timestamp  default current_timestamp() not null on update current_timestamp(),
    activation_token            varchar(255)                           null,
    activation_token_expiration datetime                               null,
    reset_token                 varchar(255)                           null,
    reset_token_expiration      datetime                               null,
    constraint email
        unique (email),
    constraint username
        unique (username)
);

