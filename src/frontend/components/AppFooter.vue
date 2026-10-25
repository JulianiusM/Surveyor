<script setup lang="ts">
import {useFrontend} from '../app/context';
const {messages, session} = useFrontend();
</script>

<template>
    <footer class="bg-dark text-white text-center py-2 mt-auto">
        <small>
            <!-- The icon's mx-1 owns its spacing. Keep
                 surrounding text adjacent and retain native nonbreaking bullet gaps. -->
            {{ messages.t('footer.poweredBy') }}<a class="text-white text-decoration-none" href="https://github.com/JulianiusM/Surveyor">
                <i class="bi bi-github mx-1" aria-hidden="true"></i>{{ messages.t('footer.versionLabel', {version: session?.shell.version ?? ''}) }}
            </a><span> •&nbsp;</span><a class="text-white text-decoration-none" href="https://www.apache.org/licenses/LICENSE-2.0">{{ messages.t('footer.license') }}</a
            ><span> •&nbsp;</span><a class="text-white text-decoration-none" :href="session?.shell.imprintUrl">{{ messages.t('footer.imprint') }}</a
            ><span> •&nbsp;</span><a class="text-white text-decoration-none" :href="session?.shell.privacyPolicyUrl">{{ messages.t('footer.privacy') }}</a>
        </small>
    </footer>
</template>
