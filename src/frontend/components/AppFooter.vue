<script setup lang="ts">
import {usePilot} from '../app/context';
const {messages, session} = usePilot();
</script>

<template>
    <footer class="bg-dark text-white text-center py-2 mt-auto">
        <small>
            {{ messages.t('footer.poweredBy') }}
            <a class="text-white text-decoration-none" href="https://github.com/JulianiusM/Surveyor">
                <i class="bi bi-github mx-1" aria-hidden="true"></i>{{ messages.t('footer.versionLabel', {version: session?.shell.version ?? ''}) }}
            </a>
            <span> • </span><a class="text-white text-decoration-none" href="https://www.apache.org/licenses/LICENSE-2.0">{{ messages.t('footer.license') }}</a>
            <span> • </span><a class="text-white text-decoration-none" :href="session?.shell.imprintUrl">{{ messages.t('footer.imprint') }}</a>
            <span> • </span><a class="text-white text-decoration-none" :href="session?.shell.privacyPolicyUrl">{{ messages.t('footer.privacy') }}</a>
        </small>
    </footer>
</template>
