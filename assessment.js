/** One-time, device-local balanced-assessment acknowledgement.
 * Uses a native modal dialog for focus trapping and keyboard accessibility.
 */
export const ACKNOWLEDGEMENT_KEY = "quickmark-balanced-assessment-v1";

export function initAssessmentAcknowledgement(root = document, storageProvider = () => window.localStorage) {
  const dialog = root.getElementById("assessmentDialog");
  const checkbox = root.getElementById("assessmentCheckbox");
  const continueButton = root.getElementById("assessmentContinue");
  const acknowledgementRow = root.getElementById("assessmentAcknowledgementRow");
  const rememberNote = root.getElementById("assessmentRememberNote");
  const reopenButton = root.getElementById("aboutAssessment");

  if (![dialog, checkbox, continueButton, acknowledgementRow, rememberNote, reopenButton].every(Boolean)) {
    throw new Error("QuickMark assessment acknowledgement controls are missing.");
  }

  let acknowledged = false;
  try {
    acknowledged = storageProvider()?.getItem(ACKNOWLEDGEMENT_KEY) === "yes";
  } catch (_) {
    // Private browsing may disallow storage; the acknowledgement still works
    // for the current page, but will appear again on a future visit.
  }

  function updateControls() {
    acknowledgementRow.hidden = acknowledged;
    rememberNote.hidden = acknowledged;
    if (acknowledged) {
      checkbox.checked = true;
      continueButton.disabled = false;
      continueButton.textContent = "Back to QuickMark";
    } else {
      continueButton.disabled = !checkbox.checked;
      continueButton.textContent = "Continue to QuickMark →";
    }
  }

  function show() {
    updateControls();
    if (!dialog.open) dialog.showModal();
    if (acknowledged) continueButton.focus();
    else checkbox.focus();
  }

  checkbox.addEventListener("change", updateControls);
  continueButton.addEventListener("click", () => {
    if (!acknowledged) {
      if (!checkbox.checked) return;
      acknowledged = true;
      try {
        storageProvider()?.setItem(ACKNOWLEDGEMENT_KEY, "yes");
      } catch (_) {
        // Do not prevent use when browser storage is restricted.
      }
    }
    dialog.close();
    updateControls();
  });

  dialog.addEventListener("cancel", (event) => {
    // The first-time acknowledgement cannot be dismissed with Escape.
    // The same dialog becomes an ordinary, dismissible information panel
    // when opened later from the footer.
    if (!acknowledged) event.preventDefault();
  });

  reopenButton.addEventListener("click", show);

  if (!acknowledged) show();
  return {show, isAcknowledged: () => acknowledged};
}
