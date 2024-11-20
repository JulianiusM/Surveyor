create or replace table responses
(
    id             int auto_increment
        primary key,
    user_id        int                                                     null,
    guest_id       int                                                     null,
    survey_id      char(36)                                                not null,
    combination_id int                                                     not null,
    answer         enum ('yes', 'no', 'maybe') default 'no'                null,
    created_at     timestamp                   default current_timestamp() not null,
    updated_at     timestamp                   default current_timestamp() not null on update current_timestamp(),
    constraint responses_ibfk_1
        foreign key (user_id) references users (id)
            on update cascade on delete cascade,
    constraint responses_ibfk_2
        foreign key (guest_id) references guests (id)
            on update cascade on delete cascade,
    constraint responses_ibfk_3
        foreign key (combination_id) references combinations (id)
            on update cascade on delete cascade,
    constraint responses_surveys_id_fk
        foreign key (survey_id) references surveys (id)
            on update cascade on delete cascade,
    constraint chk_user_or_guest
        check (`user_id` is not null and `guest_id` is null or `user_id` is null)
);

