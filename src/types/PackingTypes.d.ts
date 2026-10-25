/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Direct controller calls, versioned commands and capability projections consult the
 * Packing controller's named methods. The names describe command authority;
 * display-only title/capacity grants remain a separate presentation contract.
 */
export type PackingMethod = 'selfAssignment' | 'addItem' | 'reorderItems' | 'editDescription'
    | 'editHeader' | 'changeEvent' | 'managePermissions' | 'duplicate'
    | 'editItemTitle' | 'editItemDescription' | 'editItemCapacity' | 'editItemRequired'
    | 'editItemAttr' | 'deleteItem' | 'deleteAssignment';
