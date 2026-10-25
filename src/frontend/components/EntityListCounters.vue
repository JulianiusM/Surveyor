<script setup lang="ts">
// Matching list pages supply admitted counts and their existing feature wording.
// This owner renders the common panel only: it does not count memberships,
// infer capacity/assignment policy or retain a second copy of the list data.
defineProps<{
    participants: number;
    items: number;
    open: number;
    empty: number;
    participantsLabel: string;
    itemsLabel: string;
    openLabel: string;
    emptyLabel: string;
}>();
</script>

<template>
    <!-- Badge margins own the counter gaps. Keep labels and adjacent
         badges together so template whitespace introduces no extra spacing.
         This root replaces the existing panel without another layout wrapper. -->
    <div class="d-flex justify-content-between align-items-center mb-3">
        <span class="fs-6 fw-semibold"
            ><i class="bi bi-people-fill me-1" aria-hidden="true"></i
            >{{ participantsLabel }}:<span class="badge bg-light text-dark ms-1">{{
                participants
            }}</span></span
        >
        <span class="fs-6 fw-semibold"
            ><i class="bi bi-card-checklist me-1" aria-hidden="true"></i
            >{{ itemsLabel }}:<span class="badge bg-light text-dark ms-1">{{ items }}</span
            ><span class="badge bg-secondary-subtle text-secondary-emphasis ms-1"
                ><i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i
                >{{ open }} {{ openLabel }}</span
            ><span class="badge bg-danger-subtle text-danger-emphasis ms-1"
                ><i class="bi bi-slash-circle me-1" aria-hidden="true"></i
                >{{ empty }} {{ emptyLabel }}</span
            ></span
        >
    </div>
</template>
