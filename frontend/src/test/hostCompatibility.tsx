/** Accepted-main host contract: intentionally fixed keys, never derived from current keys. */
import type { AppProps, WorkflowHeaderContext, WorkflowStepOverrideProps } from '../App'
import type { EditionTranslationResources } from '../locales/edition'

const acceptedMainBundle = {
  "header.executionBadge": "Host-owned copy",
  "processing.dialogLabel": "Host-owned copy",
  "processing.remoteDialogLabel": "Host-owned copy",
  "processing.contextLabel": "Host-owned copy",
  "processing.remoteContextLabel": "Host-owned copy",
  "processing.fallbackMessage": "Host-owned copy",
  "processing.keepOpenNotice": "Host-owned copy",
  "voiceClone.progressDescription": "Host-owned copy",
  "books.deleteWorkingEyebrow": "Host-owned copy",
  "books.deleteWorkingDescription": "Host-owned copy",
  "books.importStorageNotice": "Host-owned copy",
  "books.workingTitle": "Host-owned copy",
  "library.storageDescription": "Host-owned copy",
  "library.openAction": "Host-owned copy",
  "library.revealAction": "Host-owned copy",
  "library.downloadAction": "Host-owned copy",
  "voiceSample.help": "Host-owned copy",
  "voiceSample.draftingShort": "Host-owned copy",
  "voiceSample.draftingStatus": "Host-owned copy",
  "errors.aiUnavailable": "Host-owned copy",
  "errors.bookProcessingActive": "Host-owned copy",
  "errors.deleteWorkingData": "Host-owned copy",
  "errors.tenantStorageLimit": "Host-owned copy",
  "errors.globalStorageCapacity": "Host-owned copy",
  "dialogue.preparingSpeakerCheck": "Host-owned copy",
  "dialogue.routingDescription": "Host-owned copy",
  "dialogue.localRuntime": "Host-owned copy",
  "dialogue.localBenefit": "Host-owned copy",
  "dialogue.remotePrivacyTradeoff": "Host-owned copy",
  "dialogue.remoteBillingTradeoff": "Host-owned copy",
  "dialogue.routingPrivacyNote": "Host-owned copy",
}
export const hostTranslations: EditionTranslationResources = {
  en: acceptedMainBundle,
  'zh-CN': acceptedMainBundle,
}
export const hostComposition: AppProps = {
  renderHeader: ({ libraryCount, navigate }: WorkflowHeaderContext) => <header><button onClick={() => navigate('library')}>{libraryCount}</button></header>,
  stepOverrides: { custom: ({ book, refresh }: WorkflowStepOverrideProps) => <button onClick={() => void refresh()}>{book?.title}</button> },
  renderLibraryActions: (item) => <a href={`/host/download/${item.id}`}>Download</a>,
  capabilities: { showExecutionBadge: false, localDialogueAttribution: false, showProviderCostReceipts: false },
}
