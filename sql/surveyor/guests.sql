create or replace table guests
(
    id         int auto_increment
        primary key,
    username   varchar(100)                          not null,
    email      varchar(100)                          null,
    token      varchar(255)                          not null,
    survey_id  char(36)                              not null,
    created_at timestamp default current_timestamp() not null,
    updated_at timestamp default current_timestamp() not null on update current_timestamp(),
    constraint token
        unique (token),
    constraint guests_surveys_id_fk
        foreign key (survey_id) references surveys (id)
            on update cascade on delete cascade
);

