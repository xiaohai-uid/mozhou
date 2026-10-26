/**
 * 应用覆盖层与浮层栈切片 Hook（useAppOverlays）。
 * 单飞互斥栈管理 wizard, desktopModal, sceneSheet, migration 浮层。
 * 栈顶浮层独占激活展示（单飞互斥），关闭退栈，避免多层 scrim/sheet 冲突。
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import type { DesktopModalType } from './DesktopToolModals'
import { loadScenePreference, saveScenePreference } from './scene/scenePreference'
import type { ScenePreference } from './scene/scenePreference'
import type { WizardOutcome } from '../wizard/WizardOverlay'
import type { BookInfo } from './workbenchStorage'

export const WIZARD_DONE_KEY = 'mozhou.wizard.done'
export const MIGRATION_HASH = '#migration'

export function migrationRequested(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hash === MIGRATION_HASH
}

export function wizardCompleted(): boolean {
  try {
    return window.localStorage.getItem(WIZARD_DONE_KEY) === 'done'
  } catch {
    return false
  }
}

export type OverlayType = 'wizard' | 'desktopModal' | 'sceneSheet' | 'migration'

export interface UseAppOverlaysOptions {
  readonly initialBook: BookInfo | null
  readonly onBookSelected?: (book: BookInfo) => void
  readonly onNavigateWorkbench?: () => void
  readonly onDataGenerationBump?: () => void
}

export interface UseAppOverlaysReturn {
  /** 当前互斥栈（底到顶） */
  readonly overlayStack: readonly OverlayType[]
  /** 栈顶当前激活浮层，无激活则为 null */
  readonly activeOverlay: OverlayType | null
  readonly wizardOpen: boolean
  readonly desktopModal: DesktopModalType
  readonly sceneSheetOpen: boolean
  readonly migrationOpen: boolean
  readonly scenePreference: ScenePreference
  readonly setScenePreference: React.Dispatch<React.SetStateAction<ScenePreference>>
  readonly openWizard: () => void
  readonly closeWizard: () => void
  readonly openDesktopModal: (modal: DesktopModalType) => void
  readonly closeDesktopModal: () => void
  readonly openSceneSheet: () => void
  readonly closeSceneSheet: () => void
  readonly openMigration: () => void
  readonly closeMigration: () => void
  readonly closeAllOverlays: () => void
  readonly handleWizardComplete: (outcome: WizardOutcome) => void
  readonly handleWizardDismiss: () => void
  readonly handleMigrationImported: (writtenCount: number) => void
}

export function useAppOverlays(options: UseAppOverlaysOptions): UseAppOverlaysReturn {
  const [overlayStack, setOverlayStack] = useState<OverlayType[]>(() => {
    const stack: OverlayType[] = []
    if (options.initialBook === null && !wizardCompleted()) {
      stack.push('wizard')
    }
    if (migrationRequested()) {
      stack.push('migration')
    }
    return stack
  })

  const [desktopModalType, setDesktopModalType] = useState<DesktopModalType>(null)
  const [scenePreference, setScenePreference] = useState<ScenePreference>(loadScenePreference)

  // 场景偏好改变后自动同步到 localStorage
  useEffect(() => {
    saveScenePreference(scenePreference)
  }, [scenePreference])

  // 将某个浮层压入互斥栈顶（单飞互斥激活）
  const pushOverlay = useCallback((overlay: OverlayType) => {
    setOverlayStack((prev) => {
      const filtered = prev.filter((item) => item !== overlay)
      return [...filtered, overlay]
    })
  }, [])

  // 从互斥栈中移除指定浮层
  const popOverlay = useCallback((overlay: OverlayType) => {
    setOverlayStack((prev) => prev.filter((item) => item !== overlay))
  }, [])

  // 监听浏览器 hash 变化同步 migration 状态
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onHashChange = () => {
      if (migrationRequested()) {
        pushOverlay('migration')
      } else {
        popOverlay('migration')
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [pushOverlay, popOverlay])

  const openWizard = useCallback(() => {
    pushOverlay('wizard')
  }, [pushOverlay])

  const closeWizard = useCallback(() => {
    popOverlay('wizard')
  }, [popOverlay])

  const openDesktopModal = useCallback(
    (modal: DesktopModalType) => {
      if (modal === null) {
        setDesktopModalType(null)
        popOverlay('desktopModal')
      } else {
        setDesktopModalType(modal)
        pushOverlay('desktopModal')
      }
    },
    [pushOverlay, popOverlay],
  )

  const closeDesktopModal = useCallback(() => {
    setDesktopModalType(null)
    popOverlay('desktopModal')
  }, [popOverlay])

  const openSceneSheet = useCallback(() => {
    pushOverlay('sceneSheet')
  }, [pushOverlay])

  const closeSceneSheet = useCallback(() => {
    popOverlay('sceneSheet')
  }, [popOverlay])

  const openMigration = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.hash !== MIGRATION_HASH) {
      window.location.hash = MIGRATION_HASH
    }
    pushOverlay('migration')
  }, [pushOverlay])

  const closeMigration = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.hash === MIGRATION_HASH) {
      window.location.hash = ''
    }
    popOverlay('migration')
  }, [popOverlay])

  const closeAllOverlays = useCallback(() => {
    setDesktopModalType(null)
    if (typeof window !== 'undefined' && window.location.hash === MIGRATION_HASH) {
      window.location.hash = ''
    }
    setOverlayStack([])
  }, [])

  const handleWizardComplete = useCallback(
    (outcome: WizardOutcome): void => {
      try {
        window.localStorage.setItem(WIZARD_DONE_KEY, 'done')
      } catch {
        // localStorage 不可用：完成标记是增强，不阻塞工作台。
      }
      options.onBookSelected?.({ root: outcome.root, bookId: outcome.bookId, title: outcome.title })
      closeWizard()
    },
    [options, closeWizard],
  )

  const handleWizardDismiss = useCallback((): void => {
    closeWizard()
    options.onNavigateWorkbench?.()
  }, [options, closeWizard])

  const handleMigrationImported = useCallback(
    (writtenCount: number): void => {
      if (writtenCount > 0) {
        options.onDataGenerationBump?.()
      }
    },
    [options],
  )

  // 栈顶浮层即为当前唯一激活的浮层（单飞互斥）
  const activeOverlay = useMemo(() => {
    return overlayStack.length > 0 ? overlayStack[overlayStack.length - 1]! : null
  }, [overlayStack])

  const wizardOpen = activeOverlay === 'wizard'
  const sceneSheetOpen = activeOverlay === 'sceneSheet'
  const migrationOpen = activeOverlay === 'migration'
  const currentDesktopModal = activeOverlay === 'desktopModal' ? desktopModalType : null

  return {
    overlayStack,
    activeOverlay,
    wizardOpen,
    desktopModal: currentDesktopModal,
    sceneSheetOpen,
    migrationOpen,
    scenePreference,
    setScenePreference,
    openWizard,
    closeWizard,
    openDesktopModal,
    closeDesktopModal,
    openSceneSheet,
    closeSceneSheet,
    openMigration,
    closeMigration,
    closeAllOverlays,
    handleWizardComplete,
    handleWizardDismiss,
    handleMigrationImported,
  }
}
