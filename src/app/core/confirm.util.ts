import Swal from 'sweetalert2';

export async function confirmAction(
  title: string,
  text?: string,
  confirmButtonText = 'Poista'
): Promise<boolean> {
  const result = await Swal.fire({
    title,
    text,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#8b1e1e',
    cancelButtonColor: '#6b7280',
    confirmButtonText,
    cancelButtonText: 'Peruuta',
    reverseButtons: true,
    focusCancel: true,
  });
  return result.isConfirmed;
}

export async function showError(message: string, title = 'Virhe'): Promise<void> {
  await Swal.fire({
    title,
    text: message,
    icon: 'error',
    confirmButtonColor: '#1f4b7a',
    confirmButtonText: 'OK',
  });
}
