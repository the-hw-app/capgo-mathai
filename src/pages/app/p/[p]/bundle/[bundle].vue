<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { valid } from 'semver'
import { useRoute, useRouter } from 'vue-router'
import copy from 'copy-text-to-clipboard'
import { Capacitor } from '@capacitor/core'
import { toast } from 'vue-sonner'
import { useSupabase } from '~/services/supabase'
import { formatDate } from '~/services/date'
import { openVersion } from '~/services/versions'
import { useMainStore } from '~/stores/main'
import type { Database } from '~/types/supabase.types'
import { appIdToUrl, bytesToMbText, urlToAppId } from '~/services/conversion'
import { useDisplayStore } from '~/stores/display'
import IconDevice from '~icons/heroicons/device-phone-mobile'
import IconInformations from '~icons/material-symbols/info-rounded'
import type { Tab } from '~/components/comp_def'
import type { OrganizationRole } from '~/stores/organization'
import { useOrganizationStore } from '~/stores/organization'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const displayStore = useDisplayStore()
const organizationStore = useOrganizationStore()
const main = useMainStore()
const supabase = useSupabase()
const ActiveTab = ref('info')
const packageId = ref<string>('')
const id = ref<number>()
const loading = ref(true)
const version = ref<Database['public']['Tables']['app_versions']['Row']>()
const channels = ref<(Database['public']['Tables']['channels']['Row'])[]>([])
const channel = ref<(Database['public']['Tables']['channels']['Row'])>()
const bundleChannels = ref<(Database['public']['Tables']['channels']['Row'])[]>([])
const version_meta = ref<Database['public']['Tables']['app_versions_meta']['Row']>()
const secondaryChannel = ref<boolean>(false)
const showBundleMetadataInput = ref<boolean>(false)

const role = ref<OrganizationRole | null>(null)
watch(version, async (version) => {
  if (!version) {
    role.value = null
    return
  }

  await organizationStore.awaitInitialLoad()
  role.value = await organizationStore.getCurrentRoleForApp(version.app_id)
  console.log(role.value)
})

async function copyToast(text: string) {
  copy(text)
  toast.success(t('copied-to-clipboard'))
}

const tabs: Tab[] = [
  {
    label: t('info'),
    icon: IconInformations,
    key: 'info',
  },
  {
    label: t('devices'),
    icon: IconDevice,
    key: 'devices',
  },
]

async function getChannels() {
  if (!version.value)
    return
  channel.value = undefined
  bundleChannels.value = []
  const { data: dataChannel } = await supabase
    .from('channels')
    .select()
    .eq('app_id', version.value.app_id)
    .order('updated_at', { ascending: false })
  channels.value = dataChannel || channels.value
  // search if the bundle is used in a channel
  channels.value.forEach((chan) => {
    const v: number = chan.version as any
    if (version.value && (v === version.value.id || version.value.id === chan.secondVersion)) {
      bundleChannels.value.push(chan)
      secondaryChannel.value = (version.value.id === chan.secondVersion)
    }
  })

  showBundleMetadataInput.value = !!bundleChannels.value.find(c => c.disableAutoUpdate === 'version_number')
}

async function openChannelLink() {
  if (!version.value || !channel.value)
    return
  router.push(`/app/p/${appIdToUrl(version.value.app_id)}/channel/${channel.value?.id}`)
}

const showSize = computed(() => {
  if (version_meta.value?.size)
    return bytesToMbText(version_meta.value.size)
  else if (version.value?.external_url)
    return t('stored-externally')
  else
    return t('metadata-not-found')
})

async function getUnknowBundleId() {
  if (!version.value)
    return
  const { data } = await supabase
    .from('app_versions')
    .select()
    .eq('app_id', version.value.app_id)
    .eq('name', 'unknown')
    .single()
  return data?.id
}

async function setChannel(channel: Database['public']['Tables']['channels']['Row'], id: number) {
  return supabase
    .from('channels')
    .update({
      version: id,
    })
    .eq('id', channel.id)
}

async function setSecondChannel(channel: Database['public']['Tables']['channels']['Row'], id: number) {
  return supabase
    .from('channels')
    .update({
      secondVersion: id,
    })
    .eq('id', channel.id)
}

async function setChannelProgressive(channel: Database['public']['Tables']['channels']['Row'], id: number) {
  return supabase
    .from('channels')
    .update({
      secondVersion: id,
      version: channel.secondVersion ?? undefined,
      secondaryVersionPercentage: 0.1,
    })
    .eq('id', channel.id)
}

async function setChannelSkipProgressive(channel: Database['public']['Tables']['channels']['Row'], id: number) {
  return supabase
    .from('channels')
    .update({
      secondVersion: id,
      version: id,
      secondaryVersionPercentage: 1,
    })
    .eq('id', channel.id)
}

async function ASChannelChooser() {
  if (!version.value)
    return
  if (role.value && !(role.value === 'admin' || role.value === 'super_admin' || role.value === 'write')) {
    toast.error(t('no-permission'))
    return
  }
  const buttons = []

  // This makes sure that A and B cannot be selected on the same time
  const commonAbHandler = async (chan: Database['public']['Tables']['channels']['Row'] | undefined, ab: 'a' | 'b') => {
    if (!chan)
      return

    const aSelected = version?.value?.id === (chan.version as any)
    const bSelected = version?.value?.id === (chan.secondVersion as any)

    if (aSelected && ab === 'b') {
      const id = await getUnknowBundleId()
      if (!id)
        return

      setChannel(chan, id)
    }
    else if (bSelected && ab === 'a') {
      const id = await getUnknowBundleId()
      if (!id)
        return

      setSecondChannel(chan, id)
    }
  }

  const normalHandler = async (chan: Database['public']['Tables']['channels']['Row']) => {
    if (!version.value)
      return
    try {
      await setChannel(chan, version.value.id)
      await getChannels()
    }
    catch (error) {
      console.error(error)
      toast.error(t('cannot-test-app-some'))
    }
  }

  const secondHandler = async (chan: Database['public']['Tables']['channels']['Row']) => {
    if (!version.value)
      return
    try {
      await setSecondChannel(chan, version.value.id)
      await getChannels()
    }
    catch (error) {
      console.error(error)
      toast.error(t('cannot-test-app-some'))
    }
  }

  for (const chan of channels.value) {
    const v: number = chan.version as any
    if (!chan.enableAbTesting && !chan.enable_progressive_deploy) {
      buttons.push({
        text: chan.name,
        selected: version.value.id === v,
        handler: async () => { await normalHandler(chan) },
      })
    }
    else if (chan.enableAbTesting && !chan.enable_progressive_deploy) {
      buttons.push({
        text: `${chan.name}-A`,
        selected: version.value.id === v,
        handler: async () => {
          await commonAbHandler(channel.value, 'a')
          await normalHandler(chan)
        },
      })
      buttons.push({
        text: `${chan.name}-B`,
        selected: version.value.id === chan.secondVersion,
        handler: async () => {
          await commonAbHandler(channel.value, 'b')
          await secondHandler(chan)
        },
      })
    }
    else {
      buttons.push({
        text: `${chan.name}`,
        selected: version.value.id === chan.secondVersion,
        handler: async () => {
          const newButtons = []
          newButtons.push({
            text: t('start-new-deploy'),
            selected: false,
            handler: async () => {
              if (!version.value)
                return

              try {
                await setChannelProgressive(chan, version.value.id)
                await getChannels()
              }
              catch (error) {
                console.error(error)
                toast.error(t('cannot-test-app-some'))
              }
            },
          })

          newButtons.push({
            text: t('force-version-change'),
            selected: false,
            handler: async () => {
              if (!version.value)
                return
              try {
                await setChannelSkipProgressive(chan, version.value.id)
                await getChannels()
              }
              catch (error) {
                console.error(error)
                toast.error(t('cannot-test-app-some'))
              }
            },
          })

          newButtons.push({
            text: t('button-cancel'),
            role: 'cancel',
            handler: () => {
              // console.log('Cancel clicked')
            },
          })

          displayStore.dialogOption = {
            header: t('progressive-deploy-option'),
            buttons: newButtons,
          }
          displayStore.showDialog = true
          return displayStore.onDialogDismiss()
        },
      })
    }
  }
  buttons.push({
    text: t('button-cancel'),
    role: 'cancel',
    handler: () => {
      // console.log('Cancel clicked')
    },
  })
  displayStore.dialogOption = {
    header: t('channel-linking'),
    buttons,
  }
  displayStore.showDialog = true
  return displayStore.onDialogDismiss()
}

async function openChannel(selChannel: Database['public']['Tables']['channels']['Row'], canHaveSecondVersion: boolean) {
  channel.value = selChannel
  if (!version.value || !main.auth)
    return
  if (!channel.value)
    return ASChannelChooser()

  displayStore.dialogOption = {
    header: t('channel-linking'),
    buttons: [
      {
        text: t('button-cancel'),
        role: 'cancel',
        handler: () => {
          // console.log('Cancel clicked')
        },
      },
    ],
  }

  // Push set-bundle if role > read
  if (displayStore.dialogOption.buttons && role.value && (role.value === 'admin' || role.value === 'super_admin' || role.value === 'write')) {
    displayStore.dialogOption.buttons.splice(0, 0, {
      text: t('set-bundle'),
      handler: () => {
        ASChannelChooser()
      },
    })
  }

  const baseIndex = (displayStore.dialogOption?.buttons?.length ?? 0) - 1

  // push in button at index 1 if channel is set
  if (channel.value && displayStore.dialogOption.buttons) {
    displayStore.dialogOption.buttons.splice(baseIndex, 0, {
      text: t('open-channel'),
      handler: () => {
        openChannelLink()
      },
    })
    if (role.value && (role.value === 'admin' || role.value === 'super_admin' || role.value === 'write')) {
      displayStore.dialogOption.buttons.splice(baseIndex + 1, 0, {
        text: t('unlink-channel'),
        handler: async () => {
          try {
            if (!channel.value)
              return
            const id = await getUnknowBundleId()
            if (!id)
              return
            if (!canHaveSecondVersion)
              await setChannel(channel.value, id)
            else
              await setSecondChannel(channel.value, id)

            await getChannels()
          }
          catch (error) {
            console.error(error)
            toast.error(t('cannot-test-app-some'))
          }
        },
      })
    }
  }
  displayStore.showDialog = true
  return displayStore.onDialogDismiss()
}
async function openDownload() {
  if (!version.value || !main.auth)
    return
  displayStore.dialogOption = {
    header: t('download'),
    buttons: [
      {
        text: Capacitor.isNativePlatform() ? t('launch-bundle') : t('download'),
        handler: async () => {
          if (!version.value)
            return
          if (version.value.session_key) {
            const command = `bunx @capgo/cli bundle decrypt ./${version.value.bucket_id}${version.value.storage_provider === 'r2' ? '' : '.zip'} ${version.value.session_key} --key ./.capgo_key`
            displayStore.dialogOption = {
              header: '',
              message: `${t('to-open-encrypted-bu')}<br/><code>${command}</code>`,
              buttons: [
                {
                  text: t('copy-command'),
                  id: 'confirm-button',
                },
              ],
            }
            displayStore.showDialog = true
            await displayStore.onDialogDismiss()
            copyToast(command)
          }
          openVersion(version.value)
        },
      },
      {
        text: t('set-bundle'),
        handler: () => {
          ASChannelChooser()
        },
      },
      {
        text: t('button-cancel'),
        role: 'cancel',
        handler: () => {
          // console.log('Cancel clicked')
        },
      },
    ],
  }
  displayStore.showDialog = true
  return displayStore.onDialogDismiss()
}

async function getVersion() {
  if (!id.value)
    return
  try {
    const { data } = await supabase
      .from('app_versions')
      .select()
      .eq('app_id', packageId.value)
      .eq('id', id.value)
      .single()
    const { data: dataVersionsMeta } = await supabase
      .from('app_versions_meta')
      .select()
      .eq('id', id.value)
      .single()
    if (!data) {
      console.error('no version found')
      router.back()
      return
    }
    if (dataVersionsMeta)
      version_meta.value = dataVersionsMeta

    version.value = data
  }
  catch (error) {
    console.error(error)
  }
}

watchEffect(async () => {
  if (route.path.includes('/bundle/')) {
    loading.value = true
    packageId.value = route.params.p as string
    packageId.value = urlToAppId(packageId.value)
    id.value = Number(route.params.bundle as string)
    await getVersion()
    await getChannels()
    loading.value = false
    displayStore.NavTitle = t('bundle')
    displayStore.defaultBack = `/app/package/${route.params.p}/bundles`
  }
})

function hideString(str: string) {
  const first = str.slice(0, 5)
  const last = str.slice(-5)
  return `${first}...${last}`
}

async function saveCustomId(input: string) {
  if (!id.value)
    return

  if (input.length === 0) {
    const { error: errorNull } = await supabase
      .from('app_versions')
      .update({
        minUpdateVersion: null,
      })
      .eq('id', id.value)

    if (errorNull) {
      console.log('Cannot set min update version to null', errorNull)
      return
    }

    toast.success(t('updated-min-version'))
    return
  }

  if (!valid(input)) {
    toast.error(t('invalid-version'))
    return
  }

  const { error } = await supabase
    .from('app_versions')
    .update({
      minUpdateVersion: input,
    })
    .eq('id', id.value)

  if (error) {
    console.log('Cannot set min update version', error)
    return
  }

  toast.success(t('updated-min-version'))
}
// const failPercent = computed(() => {
//   if (!version.value)
//     return '0%'
//   const total = version_meta.value?.installs || 1
//   const fail = version_meta.value?.fails || 1
//   return `${Math.round((fail / total) * 100).toLocaleString()}%`
// })

function guardMinAutoUpdate(event: Event) {
  if (!organizationStore.hasPermisisonsInRole(role.value, ['admin', 'super_admin', 'write'])) {
    toast.error(t('no-permission'))
    event.preventDefault()
    return false
  }
}

function preventInputChangePerm(event: Event) {
  if (!organizationStore.hasPermisisonsInRole(role.value, ['admin', 'super_admin', 'write'])) {
    event.preventDefault()
    return false
  }
}
</script>

<template>
  <div>
    <div v-if="version" class="h-full md:py-4">
      <Tabs v-model:active-tab="ActiveTab" :tabs="tabs" />
      <div v-if="ActiveTab === 'info'" id="devices" class="flex flex-col">
        <div
          class="flex flex-col overflow-y-auto bg-white shadow-lg border-slate-200 md:mx-auto md:mt-5 md:w-2/3 md:border dark:border-slate-900 md:rounded-lg dark:bg-slate-800"
        >
          <dl class="divide-y divide-gray-500">
            <InfoRow :label="t('bundle-number')" :value="version.name" />
            <InfoRow :label="t('id')" :value="version.id.toString()" />
            <InfoRow v-if="version.created_at" :label="t('created-at')" :value="formatDate(version.created_at)" />
            <InfoRow v-if="version.updated_at" :label="t('updated-at')" :value="formatDate(version.updated_at)" />
            <!-- Checksum -->
            <InfoRow v-if="version.checksum" :label="t('checksum')" :value="version.checksum" />
            <!-- Min update version -->
            <InfoRow
              v-if="showBundleMetadataInput" id="metadata-bundle"
              :label="t('min-update-version')" editable :value="version.minUpdateVersion ?? ''"
              :readonly="!organizationStore.hasPermisisonsInRole(role, ['admin', 'super_admin', 'write'])"
              @click="guardMinAutoUpdate" @update:value="saveCustomId" @keydown="preventInputChangePerm"
            />
            <!-- meta devices -->
            <InfoRow v-if="version_meta?.devices" :label="t('devices')" :value="version_meta.devices.toLocaleString()" />
            <InfoRow
              v-if="version_meta?.installs" :label="t('install')"
              :value="version_meta.installs.toLocaleString()"
            />
            <InfoRow
              v-if="version_meta?.uninstalls" :label="t('uninstall')"
              :value="version_meta.uninstalls.toLocaleString()"
            />
            <InfoRow v-if="version_meta?.fails" :label="t('fail')" :value="version_meta.fails.toLocaleString()" />
            <!-- <InfoRow v-if="version_meta?.installs && version_meta?.fails" :label="t('percent-fail')" :value="failPercent" /> -->
            <InfoRow v-if="bundleChannels && bundleChannels.length > 0" :label="t('channel')" value="">
              <template #start>
                <span v-for="chn in bundleChannels" id="open-channel" :key="chn.id">
                  <span
                    v-if="(chn!.enableAbTesting || chn!.enable_progressive_deploy) ? (chn!.secondVersion === version.id) : false"
                    class="pr-3 font-bold text-blue-600 underline cursor-pointer underline-offset-4 active dark:text-blue-500 text-dust"
                    @click="openChannel(chn, true)"
                  >
                    {{ (chn!.enableAbTesting || chn!.enable_progressive_deploy) ? ((chn!.secondVersion
                      === version.id) ? `${chn!.name}-B` : ``) : chn!.name }}
                  </span>
                  <span
                    v-if="(chn!.enableAbTesting || chn!.enable_progressive_deploy) ? (chn!.version === version.id) : false"
                    class="pr-3 font-bold text-blue-600 underline cursor-pointer underline-offset-4 active dark:text-blue-500 text-dust"
                    @click="openChannel(chn, false)"
                  >
                    {{ `${chn!.name}-A` }}
                  </span>
                  <span
                    v-if="(chn!.enableAbTesting || chn!.enable_progressive_deploy) ? false : true"
                    class="pr-3 font-bold text-blue-600 underline cursor-pointer underline-offset-4 active dark:text-blue-500 text-dust"
                    @click="openChannel(chn, false)"
                  >
                    {{ (chn!.enableAbTesting || chn!.enable_progressive_deploy) ? ((chn!.secondVersion === version.id) ? `${chn!.name}-B` : ``) : chn!.name }}
                  </span>
                </span>
              </template>
            </InfoRow>
            <InfoRow
              v-else id="open-channel" :label="t('channel')" :value="t('set-bundle')" :is-link="true"
              @click="openChannel(channel!, false)"
            />
            <!-- session_key -->
            <InfoRow
              v-if="version.session_key" :label="t('session_key')" :value="hideString(version.session_key)"
              :is-link="true" @click="copyToast(version?.session_key || '')"
            />
            <!-- version.external_url -->
            <InfoRow
              v-if="version.external_url" :label="t('url')" :value="version.external_url" :is-link="true"
              @click="copyToast(version?.external_url || '')"
            />
            <!-- size -->
            <InfoRow :label="t('size')" :value="showSize" :is-link="true" @click="openDownload()" />
            <!-- <InfoRow :label="t('preview')" :value="t('preview-short')" :is-link="true" @click="previewBundle()" /> -->
          </dl>
        </div>
      </div>
      <div v-else-if="ActiveTab === 'devices'" id="devices" class="flex flex-col">
        <div
          class="flex flex-col mx-auto overflow-y-auto bg-white shadow-lg border-slate-200 md:mt-5 md:w-2/3 md:border dark:border-slate-900 md:rounded-lg dark:bg-gray-800"
        >
          <DeviceTable class="p-3" :app-id="packageId" :version-id="version.id" />
        </div>
      </div>
    </div>
  </div>
</template>
