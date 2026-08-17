import { cn } from '@/lib/utils'

export const DEVELOPED_BY_LABEL = 'Developed by: Rakibul Hassan & Ahanaf Adud'

type AppDevelopedByFooterProps = {
  className?: string
  /** Show product copyright line above the developer credit (main ERP shell). */
  showProductLine?: boolean
  /** Hide on print (checkout / invoice / reservation tool pages). */
  printHidden?: boolean
}

export function AppDevelopedByFooter({
  className,
  showProductLine = false,
  printHidden = false,
}: AppDevelopedByFooterProps) {
  return (
    <footer
      className={cn(
        'border-t border-border bg-card px-4 py-3 text-center shrink-0',
        printHidden && 'print:hidden',
        className
      )}
    >
      {showProductLine && (
        <p className="text-xs text-muted-foreground mb-1">
          RRP Dream Inn ERP &copy; {new Date().getFullYear()}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{DEVELOPED_BY_LABEL}</p>
    </footer>
  )
}
