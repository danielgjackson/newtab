async function saveOptions(e) {
  e.preventDefault();
  try {
    await chrome.storage.sync.set({
      url: document.querySelector("#url").value,
    });
    window.close();
  } catch (error) {
    console.log(`ERROR: Problem saving settings: ${error}`);
  }
}

function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelector("#url").value = result.url || "";
  }

  function onError(error) {
    console.log(`ERROR: ${error}`);
  }

  let getting = chrome.storage.sync.get("url");
  getting.then(setCurrentChoice, onError);
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("form").addEventListener("submit", saveOptions);
