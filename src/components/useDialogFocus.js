import { useLayoutEffect, useRef } from 'react'

const openDialogs = []
const previousInertAttributes = new Map()
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',')

function getFocusableElements(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
    return element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[inert], [hidden]') &&
      element.getClientRects().length > 0 &&
      window.getComputedStyle(element).visibility !== 'hidden'
  })
}

function updateBackgroundInert() {
  for (const [element, value] of previousInertAttributes) {
    if (value === null) {
      element.removeAttribute('inert')
    } else {
      element.setAttribute('inert', value)
    }
  }
  previousInertAttributes.clear()

  let current = openDialogs.at(-1)?.dialog
  while (current?.parentElement) {
    for (const sibling of current.parentElement.children) {
      if (sibling !== current) {
        previousInertAttributes.set(sibling, sibling.getAttribute('inert'))
        sibling.setAttribute('inert', '')
      }
    }
    current = current.parentElement
    if (current === document.body) break
  }
}

/** Attach the returned ref to a dialog with tabIndex={-1}. */
export default function useDialogFocus({ isOpen, dialogKey, onClose } = {}) {
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)

  useLayoutEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!isOpen || !dialog) return undefined

    const previousFocus = document.activeElement
    const entry = { dialog }
    openDialogs.push(entry)
    updateBackgroundInert()

    function isActiveDialog() {
      return openDialogs.at(-1) === entry
    }

    function focusInside() {
      const target = getFocusableElements(dialog)[0] ?? dialog
      target.focus({ preventScroll: true })
    }

    function ensureFocusInside() {
      if (!isActiveDialog()) return
      const focused = document.activeElement
      if (!dialog.contains(focused) || focused?.matches(':disabled, [hidden], [inert]')) {
        focusInside()
      }
    }

    function onKeyDown(event) {
      if (!isActiveDialog()) return

      if (event.key === 'Escape' && closeRef.current) {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = getFocusableElements(dialog)
      const first = focusable[0]
      const last = focusable.at(-1)
      const focused = document.activeElement
      if (!first) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
      } else if (!focusable.includes(focused)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      } else if (event.shiftKey && focused === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', ensureFocusInside, true)
    const observer = new MutationObserver(ensureFocusInside)
    observer.observe(dialog, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'inert', 'tabindex'],
    })
    focusInside()

    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', ensureFocusInside, true)
      const wasActive = isActiveDialog()
      openDialogs.splice(openDialogs.indexOf(entry), 1)
      updateBackgroundInert()

      if (wasActive && previousFocus?.isConnected && !previousFocus.closest('[inert]')) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [isOpen, dialogKey])

  return dialogRef
}
