// Simple toast notification utility
type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastOptions {
  duration?: number
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
}

let toastContainer: HTMLDivElement | null = null

const createToastContainer = () => {
  if (toastContainer) return toastContainer
  
  toastContainer = document.createElement('div')
  toastContainer.id = 'toast-container'
  toastContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
  `
  document.body.appendChild(toastContainer)
  return toastContainer
}

const getToastStyles = (type: ToastType) => {
  const baseStyles = `
    padding: 12px 16px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    font-size: 14px;
    max-width: 300px;
    word-wrap: break-word;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    pointer-events: auto;
    animation: slideIn 0.3s ease-out;
  `
  
  const typeStyles = {
    success: 'background: linear-gradient(135deg, #10b981, #059669);',
    error: 'background: linear-gradient(135deg, #ef4444, #dc2626);',
    info: 'background: linear-gradient(135deg, #3b82f6, #2563eb);',
    warning: 'background: linear-gradient(135deg, #f59e0b, #d97706);'
  }
  
  return baseStyles + typeStyles[type]
}

const createToastElement = (message: string, type: ToastType) => {
  const toast = document.createElement('div')
  toast.style.cssText = getToastStyles(type)
  toast.textContent = message
  
  // Add slide-in animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }
  `
  document.head.appendChild(style)
  
  return toast
}

export const showToast = (message: string, type: ToastType = 'info', options: ToastOptions = {}) => {
  const { duration = 4000 } = options
  const container = createToastContainer()
  const toast = createToastElement(message, type)
  
  container.appendChild(toast)
  
  // Auto-remove after duration
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideOut 0.3s ease-in'
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast)
        }
      }, 300)
    }
  }, duration)
  
  // Click to dismiss
  toast.addEventListener('click', () => {
    if (toast.parentNode) {
      toast.style.animation = 'slideOut 0.3s ease-in'
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast)
        }
      }, 300)
    }
  })
  
  return toast
}
