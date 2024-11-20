create or replace table combinations
(
    id         int auto_increment
        primary key,
    survey_id  char(36)                                        not null,
    weekday    enum ('MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO') not null,
    nth_week   enum ('1', '2', '3', '4', 'LAST')               not null,
    created_at timestamp default current_timestamp()           not null,
    updated_at timestamp default current_timestamp()           not null on update current_timestamp(),
    constraint combinations_single_entry
        unique (weekday, survey_id, nth_week),
    constraint combinations_surveys_id_fk
        foreign key (survey_id) references surveys (id)
            on update cascade on delete cascade
);

