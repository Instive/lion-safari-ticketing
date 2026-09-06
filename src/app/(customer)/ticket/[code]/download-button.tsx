/**
 * Downloads the ticket as a PDF, in one tap.
 *
 * A plain link, not a button with an onClick: the server sends
 * `Content-Disposition: attachment`, so the browser downloads the file
 * directly instead of opening a print dialog and asking the guest to find
 * "Save as PDF". No JavaScript involved, so it also works if hydration has
 * not finished — which on a slow connection at the gate is exactly when
 * someone is trying to get their ticket.
 */
export function DownloadTicketButton({ bookingCode }: { bookingCode: string }) {
  return (
    <a
      href={`/api/ticket/${bookingCode}/pdf`}
      className="touch-target no-print grid w-full place-items-center rounded-xl border border-brand px-4 font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
    >
      Download ticket (PDF)
    </a>
  );
}
