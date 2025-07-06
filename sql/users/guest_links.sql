-- ---------- 2. Links zwischen Gast und beliebigem Objekt ----------
--  entity_type z. B. 'survey', 'packing'
CREATE OR REPLACE TABLE guest_links
(
    guest_id    INT                                  NOT NULL,
    entity_type ENUM ('survey','packing','activity') NOT NULL,
    entity_id   CHAR(36)                             NOT NULL,
    token       VARCHAR(255)                         NOT NULL, -- individueller Edit-Token
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP  NOT NULL,
    PRIMARY KEY (guest_id, entity_type, entity_id),
    UNIQUE KEY uk_token (token),
    FOREIGN KEY (guest_id) REFERENCES guests (id)
        ON UPDATE CASCADE ON DELETE CASCADE
    -- FK auf entity_id bewusst weggelassen → ein Link kann
    -- auf unterschiedliche Tabellen zeigen; Logik regelt die App
);