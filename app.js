(() => {
  "use strict";

  const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  const supportedExtensions = new Set(["jpg", "jpeg", "png", "webp"]);
  const heicExtensions = new Set(["heic", "heif"]);
  const missingText = "This field was not included by the camera or app.";

  const tabs = [
    { id: "summary", label: "Summary", icon: "layout-dashboard" },
    { id: "camera", label: "Camera", icon: "camera" },
    { id: "location", label: "Location", icon: "map-pinned" },
    { id: "image", label: "Image", icon: "image" },
    { id: "copyright", label: "Copyright", icon: "copyright" },
    { id: "full", label: "Full EXIF", icon: "search" },
  ];

  const web3FormsEndpoint = "https://api.web3forms.com/submit";
  const web3FormsAccessKey = "fa6d2560-54ee-402f-942e-e933135ea66f";

  const state = {
    items: [],
    notices: [],
    loveMessages: [],
    batchMessage: "Metadata removal creates a new cleaned copy. Your original file is not modified.",
    isBusy: false,
  };

  const elements = {};
  const mapRefs = new Map();

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    loadLoveMessages();
    render();
  }

  function cacheElements() {
    elements.fileInput = document.querySelector("#fileInput");
    elements.dropzone = document.querySelector("#dropzone");
    elements.pickFiles = document.querySelector("#pickFiles");
    elements.uploadFeedback = document.querySelector("#uploadFeedback");
    elements.results = document.querySelector("#results");
    elements.batchActions = document.querySelector("#batchActions");
    elements.batchTitle = document.querySelector("#batchTitle");
    elements.batchStatus = document.querySelector("#batchStatus");
    elements.cleanAll = document.querySelector("#cleanAll");
    elements.downloadAll = document.querySelector("#downloadAll");
    elements.clearAll = document.querySelector("#clearAll");
    elements.toastRegion = document.querySelector("#toastRegion");
    elements.loveForm = document.querySelector("#loveForm");
    elements.loveName = document.querySelector("#loveName");
    elements.loveNote = document.querySelector("#loveNote");
    elements.lovePageUrl = document.querySelector("#lovePageUrl");
    elements.loveMessage = document.querySelector("#loveMessage");
    elements.loveList = document.querySelector("#loveList");
    elements.heartLayer = document.querySelector("#heartLayer");
  }

  function bindEvents() {
    elements.pickFiles.addEventListener("click", () => elements.fileInput.click());
    elements.fileInput.addEventListener("change", (event) => {
      handleFiles(event.target.files);
      event.target.value = "";
    });

    elements.dropzone.addEventListener("click", (event) => {
      if (!event.target.closest("button")) {
        elements.fileInput.click();
      }
    });

    elements.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        elements.fileInput.click();
      }
    });

    ["dragenter", "dragover"].forEach((name) => {
      elements.dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        elements.dropzone.classList.add("is-dragging");
      });
    });

    ["dragleave", "drop"].forEach((name) => {
      elements.dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        elements.dropzone.classList.remove("is-dragging");
      });
    });

    elements.dropzone.addEventListener("drop", (event) => {
      handleFiles(event.dataTransfer.files);
    });

    elements.results.addEventListener("click", handleResultClick);
    elements.results.addEventListener("input", handleResultInput);
    elements.results.addEventListener("keydown", handleResultKeydown);
    elements.results.addEventListener("toggle", handleDetailsToggle, true);

    elements.cleanAll.addEventListener("click", () => cleanAllItems());
    elements.downloadAll.addEventListener("click", () => downloadAllCleaned());
    elements.clearAll.addEventListener("click", clearAllItems);

    elements.loveForm.addEventListener("submit", handleLoveSubmit);

    window.addEventListener("beforeunload", () => {
      cleanupMaps();
      state.items.forEach((item) => stopLiveGps(item, { silent: true }));
      state.items.forEach(revokeItemUrls);
    });
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const accepted = [];
    files.forEach((file) => {
      const support = validateFile(file);
      if (!support.ok) {
        addNotice(`${file.name}: ${support.message}`);
        return;
      }

      const item = createItem(file);
      state.items.push(item);
      accepted.push(item);
    });

    if (!accepted.length) {
      render();
      return;
    }

    state.batchMessage = `${accepted.length} image${accepted.length === 1 ? "" : "s"} added. Reading metadata locally...`;
    render();

    for (const item of accepted) {
      await processItem(item);
      render();
      await nextFrame();
    }

    state.batchMessage = "Metadata removal creates a new cleaned copy. Your original file is not modified.";
    render();
    showToast(`Press inspected ${accepted.length} image${accepted.length === 1 ? "" : "s"} locally.`, "success");
  }

  function validateFile(file) {
    const extension = getExtension(file.name);

    if (heicExtensions.has(extension) || ["image/heic", "image/heif"].includes(file.type)) {
      return {
        ok: false,
        message:
          "HEIC/HEIF is not supported here because browsers cannot reliably decode it without a heavier converter. Convert it to JPG, PNG, or WebP and try again.",
      };
    }

    if (supportedMimeTypes.has(file.type) || (!file.type && supportedExtensions.has(extension))) {
      return { ok: true };
    }

    if (supportedExtensions.has(extension)) {
      return { ok: true };
    }

    return {
      ok: false,
      message: "Press supports JPG, PNG, and WebP images. This file type was skipped safely.",
    };
  }

  function createItem(file) {
    return {
      id: createId(),
      file,
      originalUrl: URL.createObjectURL(file),
      cleanedBlob: null,
      cleanedUrl: null,
      outputFileName: makeCleanedFileName(file.name),
      rawMetadata: {},
      rawRows: null,
      metadataNotice: "",
      cleanNotice: "",
      dimensions: null,
      gps: null,
      simplified: null,
      status: "reading",
      error: "",
      activeTab: "summary",
      rawQuery: "",
      fullExifOpen: false,
      geoWatchId: null,
      liveGps: null,
      liveStatus: "",
      liveError: "",
    };
  }

  async function processItem(item) {
    item.status = "reading";
    item.error = "";

    const [dimensionResult, exifResult] = await Promise.allSettled([
      readImageDimensions(item.file),
      readExifMetadata(item.file),
    ]);

    if (dimensionResult.status === "fulfilled") {
      item.dimensions = dimensionResult.value;
    }

    if (exifResult.status === "fulfilled") {
      item.rawMetadata = exifResult.value.metadata;
      item.metadataNotice = exifResult.value.notice;
    } else {
      item.rawMetadata = {};
      item.metadataNotice = "Press could not read embedded metadata from this image, but image properties are still shown.";
    }

    item.gps = extractGps(item.rawMetadata);
    item.simplified = buildMetadataGroups(item);
    item.rawRows = null;
    item.status = "ready";

    if (dimensionResult.status === "rejected" && !Object.keys(item.rawMetadata).length) {
      item.error = "Press could not decode this image in the browser. Try a different JPG, PNG, or WebP file.";
    }
  }

  async function readExifMetadata(file) {
    if (!window.exifr || typeof window.exifr.parse !== "function") {
      return {
        metadata: {},
        notice: "The metadata reader did not load. Image properties from the file object are still shown.",
      };
    }

    try {
      const metadata = await window.exifr.parse(file, {
        tiff: true,
        ifd0: true,
        exif: true,
        gps: true,
        interop: true,
        xmp: true,
        iptc: true,
        icc: true,
        jfif: true,
        ihdr: true,
        mergeOutput: true,
        reviveValues: true,
        translateKeys: true,
        translateValues: true,
        sanitize: true,
      });

      return {
        metadata: metadata || {},
        notice: metadata
          ? ""
          : "No embedded EXIF data was found. This is common for screenshots, edited photos, and social media downloads.",
      };
    } catch (error) {
      return {
        metadata: {},
        notice:
          "No readable embedded metadata was found. Metadata availability depends on the device, app, and file format.",
      };
    }
  }

  async function readImageDimensions(file) {
    if ("createImageBitmap" in window) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return dimensions;
      } catch (error) {
        const bitmap = await createImageBitmap(file);
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return dimensions;
      }
    }

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dimensions);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image decode failed"));
      };
      image.src = url;
    });
  }

  function buildMetadataGroups(item) {
    const raw = item.rawMetadata || {};
    const file = item.file;
    const dimensions = item.dimensions || {};

    const camera = [
      row("Camera Make", pick(raw, ["Make", "CameraMake", "make"]), "The camera or phone manufacturer."),
      row("Camera Model", pick(raw, ["Model", "CameraModel", "model"]), "The camera or phone model."),
      row("Lens Model", pick(raw, ["LensModel", "Lens", "LensInfo"]), "The lens used, when the camera records it."),
      row("Focal Length", formatFocalLength(pick(raw, ["FocalLength", "FocalLengthIn35mmFormat"])), "Lens zoom or focal distance, usually shown in millimeters."),
      row("Aperture", formatAperture(pick(raw, ["FNumber", "ApertureValue", "Aperture"])), "The lens opening. Lower f-numbers usually mean more light."),
      row("ISO", pick(raw, ["ISO", "ISOSpeedRatings", "PhotographicSensitivity"]), "Sensor sensitivity used for the shot."),
      row("Exposure Time", formatExposure(pick(raw, ["ExposureTime", "ShutterSpeedValue"])), "How long the shutter stayed open."),
      row("Flash", formatFlash(pick(raw, ["Flash"])), "Whether flash information was recorded."),
      row("White Balance", formatWhiteBalance(pick(raw, ["WhiteBalance"])), "How the camera balanced color temperature."),
      row("Metering Mode", pick(raw, ["MeteringMode"]), "How the camera measured light."),
      row("Orientation", formatOrientation(pick(raw, ["Orientation"])), "How the image should be rotated for display."),
    ];

    const location = [
      row("Latitude", item.gps ? formatCoordinate(item.gps.latitude) : null, "North-south GPS coordinate."),
      row("Longitude", item.gps ? formatCoordinate(item.gps.longitude) : null, "East-west GPS coordinate."),
      row("Altitude", item.gps ? item.gps.altitude : null, "Height above sea level, when recorded."),
      row("GPS Timestamp", item.gps ? item.gps.timestamp : null, "Time recorded by the GPS module, when available."),
    ];

    const image = [
      row("File Name", file.name, "The original file name selected in your browser."),
      row("File Type", prettyFileType(file), "The file format reported by the browser."),
      row("File Size", formatBytes(file.size), "The size of the original file."),
      row("Image Width", dimensions.width ? `${dimensions.width}px` : null, "Pixel width decoded by the browser."),
      row("Image Height", dimensions.height ? `${dimensions.height}px` : null, "Pixel height decoded by the browser."),
      row("Megapixels", dimensions.width && dimensions.height ? `${formatNumber((dimensions.width * dimensions.height) / 1000000, 2)} MP` : null, "Total pixel count expressed in megapixels."),
      row("Color Space", pick(raw, ["ColorSpace", "ProfileDescription", "ICCProfileName", "ColorModel"]), "Color profile or color model metadata."),
      row("Bit Depth", formatBitDepth(pick(raw, ["BitsPerSample", "BitDepth", "BitsPerPixel"])), "How much color information is stored per channel or pixel."),
      row("Last Modified Date", file.lastModified ? formatDate(file.lastModified) : null, "The file modified date provided by your browser."),
    ];

    const date = [
      row("Date Taken", formatDateValue(pick(raw, ["DateTimeOriginal", "CreateDate", "DateCreated"])), "When the camera says the photo was taken."),
      row("Date Modified", formatDateValue(pick(raw, ["ModifyDate", "DateTime"])), "When the embedded metadata says the image was modified."),
      row("Date Digitized", formatDateValue(pick(raw, ["DateTimeDigitized", "DigitalCreationDate", "CreateDate"])), "When the image was digitized or created by software."),
      row("Time Zone Offset", pick(raw, ["OffsetTime", "OffsetTimeOriginal", "OffsetTimeDigitized", "TimeZoneOffset"]), "Time zone information, if the camera or app included it."),
    ];

    const copyright = [
      row("Artist / Creator", pick(raw, ["Artist", "Creator", "By-line", "Byline"]), "Creator name stored in metadata."),
      row("Copyright", pick(raw, ["Copyright", "CopyrightNotice", "Rights"]), "Copyright or rights notice."),
      row("Software", pick(raw, ["Software", "ProcessingSoftware"]), "Camera firmware or editing app."),
      row("Description", pick(raw, ["ImageDescription", "Description", "Caption-Abstract"]), "Description or caption embedded in the file."),
      row("Comments", pick(raw, ["UserComment", "XPComment", "Comment"]), "Comment fields added by a camera or app."),
      row("Owner Name", pick(raw, ["OwnerName", "CameraOwnerName"]), "Camera owner name, when configured."),
    ];

    return { camera, location, image, date, copyright };
  }

  function render() {
    cleanupMaps();
    renderUploadFeedback();
    renderBatchActions();
    renderResults();
    renderLoveMessages();
    refreshIcons();
    window.requestAnimationFrame(initializeVisibleMaps);
  }

  function renderUploadFeedback() {
    if (!state.notices.length) {
      elements.uploadFeedback.innerHTML = "";
      return;
    }

    elements.uploadFeedback.innerHTML = `
      <ul class="notice-list">
        ${state.notices
          .slice(-4)
          .map(
            (notice) => `
              <li class="notice">
                <i data-lucide="circle-alert"></i>
                <span>${escapeHtml(notice.message)}</span>
              </li>
            `,
          )
          .join("")}
      </ul>
    `;
  }

  function renderBatchActions() {
    const hasItems = state.items.length > 0;
    elements.batchActions.hidden = !hasItems;
    if (!hasItems) return;

    const readyCount = state.items.filter((item) => item.status === "ready" || item.status === "cleaned").length;
    const cleanedCount = state.items.filter((item) => item.cleanedBlob).length;

    elements.batchTitle.textContent = `${state.items.length} image${state.items.length === 1 ? "" : "s"} loaded`;
    elements.batchStatus.textContent = state.batchMessage || `${readyCount} ready, ${cleanedCount} cleaned.`;
    elements.cleanAll.disabled = state.isBusy || !readyCount;
    elements.downloadAll.disabled = state.isBusy || !state.items.length;
    elements.clearAll.disabled = state.isBusy;
  }

  function renderResults() {
    if (!state.items.length) {
      elements.results.innerHTML = `
        <div class="empty-state">
          <img src="assets/sample-placeholder.svg" alt="" width="148" height="148">
          <p class="section-kicker">Nothing loaded yet</p>
          <h2>Your photo privacy checkup will appear here.</h2>
          <p>
            Add one or more photos to see camera details, GPS data, image
            properties, copyright fields, and a full searchable EXIF table.
          </p>
        </div>
      `;
      return;
    }

    elements.results.innerHTML = state.items.map(renderCard).join("");
  }

  function renderCard(item) {
    const activeTab = item.activeTab || "summary";
    const readableSize = formatBytes(item.file.size);
    const isBusy = item.status === "reading" || item.status === "cleaning";
    const cleaned = Boolean(item.cleanedBlob);

    return `
      <article class="result-card" id="item-${item.id}" aria-labelledby="title-${item.id}">
        <div class="card-top">
          <figure class="preview-frame">
            <img src="${item.originalUrl}" alt="Preview of ${escapeAttr(item.file.name)}" loading="lazy">
          </figure>
          <div class="card-summary">
            <div class="card-heading">
              <div>
                <h3 id="title-${item.id}">${escapeHtml(item.file.name)}</h3>
                <p class="card-subtitle">${escapeHtml(prettyFileType(item.file))} · ${escapeHtml(readableSize)}</p>
              </div>
              <button class="icon-button" type="button" data-action="remove-item" data-id="${item.id}" aria-label="Remove ${escapeAttr(item.file.name)} from Press">
                <i data-lucide="x"></i>
              </button>
            </div>

            <div class="badge-row" aria-label="Metadata summary">
              ${renderBadges(item)}
            </div>

            <div class="status-line" aria-label="Before and after status">
              <span class="status-pill">${hasMeaningfulMetadata(item) ? "Original metadata detected" : "Little embedded metadata found"}</span>
              <span class="status-pill">${cleaned ? "Clean copy ready" : "Not cleaned yet"}</span>
            </div>

            <div class="card-actions">
              <button class="button button-secondary" type="button" data-action="tab" data-tab="full" data-id="${item.id}" ${isBusy ? "disabled" : ""}>
                <i data-lucide="search"></i>
                View Full EXIF
              </button>
              <button class="button button-primary" type="button" data-action="clean" data-id="${item.id}" ${item.status === "reading" || state.isBusy ? "disabled" : ""}>
                <i data-lucide="eraser"></i>
                ${item.status === "cleaning" ? "Cleaning..." : "Remove Metadata"}
              </button>
              <button class="button button-secondary" type="button" data-action="download" data-id="${item.id}" ${!cleaned || state.isBusy ? "disabled" : ""}>
                <i data-lucide="download"></i>
                Download Clean Copy
              </button>
            </div>

            <p class="small-note">
              Metadata removal creates a new cleaned copy. Your original file is not modified.
              ${item.cleanNotice ? `<br>${escapeHtml(item.cleanNotice)}` : ""}
            </p>
          </div>
        </div>

        <div class="tab-shell">
          <div class="tablist" role="tablist" aria-label="Metadata sections for ${escapeAttr(item.file.name)}">
            ${tabs.map((tab) => renderTabButton(item, tab, activeTab)).join("")}
          </div>
          <section class="tab-panel" id="panel-${item.id}-${activeTab}" role="tabpanel" aria-labelledby="tab-${item.id}-${activeTab}">
            ${renderTabContent(item, activeTab)}
          </section>
        </div>
      </article>
    `;
  }

  function renderBadges(item) {
    const badges = [];
    badges.push(
      item.gps
        ? badge("GPS Found", "map-pin", "success")
        : badge("No GPS", "map-pin-off", "neutral"),
    );
    badges.push(
      hasCameraInfo(item)
        ? badge("Camera Info Found", "camera", "success")
        : badge("Camera Info Missing", "camera-off", "warning"),
    );
    badges.push(
      item.cleanedBlob
        ? badge("Cleaned", "sparkles", "clean")
        : badge("Not Cleaned", "circle", "neutral"),
    );
    badges.push(badge(formatBytes(item.file.size), "hard-drive", "neutral"));
    return badges.join("");
  }

  function badge(label, icon, tone) {
    return `<span class="badge badge-${tone}"><i data-lucide="${icon}"></i>${escapeHtml(label)}</span>`;
  }

  function renderTabButton(item, tab, activeTab) {
    const selected = tab.id === activeTab;
    return `
      <button
        class="tab-button"
        type="button"
        role="tab"
        id="tab-${item.id}-${tab.id}"
        aria-selected="${selected}"
        aria-controls="panel-${item.id}-${tab.id}"
        data-action="tab"
        data-tab="${tab.id}"
        data-id="${item.id}"
      >
        <i data-lucide="${tab.icon}"></i>
        ${escapeHtml(tab.label)}
      </button>
    `;
  }

  function renderTabContent(item, tabId) {
    if (item.status === "reading") {
      return renderLoading("Reading metadata locally...");
    }

    if (item.status === "cleaning") {
      return renderLoading("Creating a clean browser-rendered copy...");
    }

    if (item.error) {
      return renderPanel("friendly", "circle-alert", "Something went sideways", item.error);
    }

    switch (tabId) {
      case "camera":
        return renderCameraTab(item);
      case "location":
        return renderLocationTab(item);
      case "image":
        return renderImageTab(item);
      case "copyright":
        return renderCopyrightTab(item);
      case "full":
        return renderFullExifTab(item);
      case "summary":
      default:
        return renderSummaryTab(item);
    }
  }

  function renderSummaryTab(item) {
    const groups = item.simplified;
    const cameraName = compactJoin([
      getRowValue(groups.camera, "Camera Make"),
      getRowValue(groups.camera, "Camera Model"),
    ]);
    const dimensions = item.dimensions
      ? `${item.dimensions.width} x ${item.dimensions.height}px`
      : null;
    const dateTaken = getRowValue(groups.date, "Date Taken");
    const gpsSummary = item.gps
      ? `${formatCoordinate(item.gps.latitude)}, ${formatCoordinate(item.gps.longitude)}`
      : "No GPS data found";

    return `
      ${item.metadataNotice ? renderPanel("friendly", "info", "Metadata note", item.metadataNotice) : ""}
      ${item.gps ? renderPanel("warning", "map-pin", "GPS data found", "This image contains GPS location data. Sharing it publicly may reveal where the photo was taken.") : ""}
      ${item.cleanedBlob ? renderPanel("success", "check-circle-2", "Clean copy ready", "Download the cleaned copy whenever you are ready. Your original file was not changed.") : ""}
      <div class="summary-grid">
        ${renderSummaryItem("Camera", cameraName || "Camera details were not included.")}
        ${renderSummaryItem("Location", gpsSummary)}
        ${renderSummaryItem("Date Taken", dateTaken || "Date metadata was not included.")}
        ${renderSummaryItem("Image", dimensions || "Dimensions are not available.")}
      </div>
      <p class="small-note">
        Some metadata fields are added by cameras, while others are added by editing apps.
        Some social media apps remove metadata before upload.
      </p>
    `;
  }

  function renderCameraTab(item) {
    return `
      ${renderPanel("friendly", "camera", "Camera details", "Metadata availability depends on the camera, phone, app, and file format. Missing fields are normal.")}
      ${renderRows(item.simplified.camera)}
    `;
  }

  function renderLocationTab(item) {
    if (!item.gps) {
      return `
        ${renderPanel("friendly", "map-pin-off", "No GPS data found in this image.", "This is common for screenshots, edited photos, and social media downloads. Location tagging may also be disabled on the device.")}
        ${renderRows(item.simplified.location)}
      `;
    }

    return `
      ${renderPanel("warning", "map-pin", "This image contains GPS location data.", "Sharing it publicly may reveal where the photo was taken. The map is interactive, and live GPS is optional.")}
      <div class="map-actions" aria-label="GPS map actions">
        <button class="button button-primary" type="button" data-action="track-location" data-id="${item.id}">
          <i data-lucide="crosshair"></i>
          Use live GPS
        </button>
        <button class="button button-secondary" type="button" data-action="stop-location" data-id="${item.id}" ${item.geoWatchId == null ? "disabled" : ""}>
          <i data-lucide="circle-stop"></i>
          Stop live GPS
        </button>
        <a class="button button-secondary" href="${escapeAttr(makeGoogleMapsUrl(item.gps))}" target="_blank" rel="noopener noreferrer">
          <i data-lucide="external-link"></i>
          Google Maps
        </a>
        <a class="button button-secondary" href="${escapeAttr(makeOpenStreetMapUrl(item.gps))}" target="_blank" rel="noopener noreferrer">
          <i data-lucide="map"></i>
          OpenStreetMap
        </a>
        <button class="button button-ghost" type="button" data-action="copy-coordinates" data-id="${item.id}">
          <i data-lucide="copy"></i>
          Copy coordinates
        </button>
      </div>
      <div class="map-pane" id="map-${item.id}" data-map-item="${item.id}" aria-label="Interactive GPS map for ${escapeAttr(item.file.name)}"></div>
      <div class="live-status" data-live-status="${item.id}">
        ${renderLiveGpsStatus(item)}
      </div>
      <p class="coordinate-line">Latitude ${formatCoordinate(item.gps.latitude)} · Longitude ${formatCoordinate(item.gps.longitude)}</p>
      ${renderRows(item.simplified.location)}
    `;
  }

  function renderImageTab(item) {
    return `
      ${renderPanel("friendly", "image", "Image properties", "These fields combine browser file information with embedded metadata when it exists.")}
      ${renderRows(item.simplified.image)}
      ${renderRows(item.simplified.date)}
    `;
  }

  function renderCopyrightTab(item) {
    return `
      ${renderPanel("friendly", "copyright", "Creator and copyright fields", "These fields are often empty unless a camera, creator workflow, or editing app added them.")}
      ${renderRows(item.simplified.copyright)}
    `;
  }

  function renderFullExifTab(item) {
    const count = getRawRows(item).length;
    const open = item.fullExifOpen ? "open" : "";
    const query = item.rawQuery || "";

    return `
      <details class="advanced" data-advanced-id="${item.id}" ${open}>
        <summary>
          <span>Advanced / Full EXIF Data</span>
          <span>${count} field${count === 1 ? "" : "s"}</span>
        </summary>
        <div class="advanced-body">
          <label class="search-field">
            Search raw metadata
            <input
              type="search"
              value="${escapeAttr(query)}"
              placeholder="Filter by key or value"
              data-action="filter-exif"
              data-id="${item.id}"
            >
          </label>
          <div class="raw-table-wrap" data-raw-table="${item.id}">
            ${renderRawTable(item, query)}
          </div>
          <p class="small-note">
            Raw metadata can be technical. Press keeps this collapsed by default so the useful summary stays easy to scan.
          </p>
        </div>
      </details>
    `;
  }

  function renderRows(rows) {
    return `
      <table class="metadata-table">
        <tbody>
          ${rows
            .map(
              (item) => `
                <tr>
                  <th scope="row">
                    <span class="label-with-help">
                      ${escapeHtml(item.label)}
                      ${item.help ? `<span class="help-dot" tabindex="0" aria-label="${escapeAttr(item.help)}" data-tip="${escapeAttr(item.help)}">?</span>` : ""}
                    </span>
                  </th>
                  <td>${item.missing ? `<span class="missing-value">${escapeHtml(item.missingMessage || missingText)}</span>` : escapeHtml(item.value)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderRawTable(item, query) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const rows = getRawRows(item).filter((entry) => {
      if (!normalizedQuery) return true;
      return `${entry.key} ${entry.value}`.toLowerCase().includes(normalizedQuery);
    });

    if (!rows.length) {
      return renderPanel(
        "friendly",
        "search-x",
        normalizedQuery ? "No matching metadata fields" : "No raw metadata found",
        normalizedQuery
          ? "Try a different search term."
          : "This image did not include readable embedded EXIF metadata.",
      );
    }

    return `
      <table class="metadata-table">
        <thead>
          <tr>
            <th scope="col">Metadata key</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (entry) => `
                <tr>
                  <td><code>${escapeHtml(entry.key)}</code></td>
                  <td>${escapeHtml(entry.value)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderSummaryItem(label, value) {
    return `
      <div class="summary-item">
        <p class="summary-label">${escapeHtml(label)}</p>
        <p class="summary-value">${escapeHtml(value)}</p>
      </div>
    `;
  }

  function renderPanel(type, icon, title, copy) {
    return `
      <div class="${type}-panel">
        <i data-lucide="${icon}"></i>
        <div>
          <p class="panel-title">${escapeHtml(title)}</p>
          <p class="panel-copy">${escapeHtml(copy)}</p>
        </div>
      </div>
    `;
  }

  function renderLiveGpsStatus(item) {
    if (item.liveError) {
      return renderPanel("friendly", "circle-alert", "Live GPS unavailable", item.liveError);
    }

    if (item.liveGps) {
      const distance = distanceBetween(
        item.gps.latitude,
        item.gps.longitude,
        item.liveGps.latitude,
        item.liveGps.longitude,
      );
      return renderPanel(
        "success",
        "navigation",
        "Live GPS active",
        `Your browser location is about ${formatDistance(distance)} from this photo point. Press does not store it.`,
      );
    }

    if (item.liveStatus) {
      return renderPanel("friendly", "crosshair", "Live GPS", item.liveStatus);
    }

    return renderPanel(
      "friendly",
      "mouse-pointer-click",
      "Interactive GPS map",
      "Zoom, pan, open this coordinate in a map app, or compare it with your current browser location.",
    );
  }

  function makeGoogleMapsUrl(gps) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gps.latitude},${gps.longitude}`)}`;
  }

  function makeOpenStreetMapUrl(gps) {
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(gps.latitude)}&mlon=${encodeURIComponent(gps.longitude)}#map=16/${encodeURIComponent(gps.latitude)}/${encodeURIComponent(gps.longitude)}`;
  }

  function renderLoading(message) {
    return `
      ${renderPanel("friendly", "loader-circle", "Working locally", message)}
      <div class="skeleton-stack" aria-hidden="true">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
    `;
  }

  function handleResultClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;

    const action = button.dataset.action;
    const id = button.dataset.id;
    const item = findItem(id);

    if (action === "tab" && item) {
      item.activeTab = button.dataset.tab || "summary";
      if (item.activeTab === "full") item.fullExifOpen = true;
      render();
      return;
    }

    if (action === "remove-item" && item) {
      removeItem(item.id);
      return;
    }

    if (action === "clean" && item) {
      cleanSingleItem(item.id);
      return;
    }

    if (action === "download" && item) {
      downloadItem(item);
      return;
    }

    if (action === "track-location" && item) {
      startLiveGps(item);
      return;
    }

    if (action === "stop-location" && item) {
      stopLiveGps(item);
      return;
    }

    if (action === "copy-coordinates" && item) {
      copyCoordinates(item);
    }
  }

  function handleResultInput(event) {
    const input = event.target.closest("[data-action='filter-exif']");
    if (!input) return;

    const item = findItem(input.dataset.id);
    if (!item) return;

    item.rawQuery = input.value;
    const target = elements.results.querySelector(`[data-raw-table="${cssEscape(item.id)}"]`);
    if (target) {
      target.innerHTML = renderRawTable(item, item.rawQuery);
      refreshIcons();
    }
  }

  function handleResultKeydown(event) {
    const tab = event.target.closest(".tab-button");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    const tabButtons = Array.from(tab.closest(".tablist").querySelectorAll(".tab-button"));
    const currentIndex = tabButtons.indexOf(tab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabButtons.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabButtons.length - 1;

    event.preventDefault();
    tabButtons[nextIndex].focus();
    tabButtons[nextIndex].click();
  }

  function handleDetailsToggle(event) {
    const details = event.target.closest("[data-advanced-id]");
    if (!details) return;

    const item = findItem(details.dataset.advancedId);
    if (item) {
      item.fullExifOpen = details.open;
    }
  }

  function startLiveGps(item) {
    if (!item.gps) return;

    if (!navigator.geolocation) {
      item.liveError = "This browser does not provide live geolocation.";
      render();
      showToast("Live GPS is not available in this browser.", "warning");
      return;
    }

    if (item.geoWatchId != null) {
      showToast("Live GPS is already active for this image.", "success");
      return;
    }

    item.liveError = "";
    item.liveStatus = "Waiting for browser permission. Your live location stays in this page and is not saved by Press.";
    render();

    item.geoWatchId = navigator.geolocation.watchPosition(
      (position) => {
        item.liveError = "";
        item.liveStatus = "";
        item.liveGps = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };
        updateLiveGpsPanel(item);
        updateLiveGpsOnMap(item);
      },
      (error) => {
        item.liveError = geolocationErrorMessage(error);
        item.liveStatus = "";
        updateLiveGpsPanel(item);
        showToast(item.liveError, "warning");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000,
      },
    );
    render();
  }

  function stopLiveGps(item, options = {}) {
    if (item.geoWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(item.geoWatchId);
    }

    item.geoWatchId = null;
    item.liveGps = null;
    item.liveStatus = "";
    item.liveError = "";

    const mapRef = mapRefs.get(item.id);
    if (mapRef) {
      [mapRef.liveMarker, mapRef.accuracyCircle, mapRef.distanceLine].forEach((layer) => {
        if (layer) layer.remove();
      });
      mapRef.liveMarker = null;
      mapRef.accuracyCircle = null;
      mapRef.distanceLine = null;
    }

    if (!options.silent) {
      render();
      showToast("Live GPS stopped for this image.", "success");
    }
  }

  async function copyCoordinates(item) {
    if (!item.gps) return;

    const text = `${formatNumber(item.gps.latitude, 8)}, ${formatNumber(item.gps.longitude, 8)}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Coordinates copied.", "success");
    } catch (error) {
      showToast(`Coordinates: ${text}`, "success");
    }
  }

  function updateLiveGpsPanel(item) {
    const target = elements.results.querySelector(`[data-live-status="${cssEscape(item.id)}"]`);
    if (target) {
      target.innerHTML = renderLiveGpsStatus(item);
      refreshIcons();
    }
  }

  function updateLiveGpsOnMap(item) {
    const mapRef = mapRefs.get(item.id);
    if (!mapRef || !item.liveGps) return;

    const liveLatLng = [item.liveGps.latitude, item.liveGps.longitude];
    const photoLatLng = [item.gps.latitude, item.gps.longitude];

    if (!mapRef.liveMarker) {
      mapRef.liveMarker = window.L.circleMarker(liveLatLng, {
        radius: 8,
        color: "#0e4f9e",
        fillColor: "#1c6dd0",
        fillOpacity: 0.92,
        weight: 3,
      })
        .addTo(mapRef.map)
        .bindPopup("Your live browser location");
    } else {
      mapRef.liveMarker.setLatLng(liveLatLng);
    }

    if (!mapRef.accuracyCircle) {
      mapRef.accuracyCircle = window.L.circle(liveLatLng, {
        radius: item.liveGps.accuracy || 25,
        color: "#1c6dd0",
        fillColor: "#1c6dd0",
        fillOpacity: 0.08,
        weight: 1,
      }).addTo(mapRef.map);
    } else {
      mapRef.accuracyCircle.setLatLng(liveLatLng);
      mapRef.accuracyCircle.setRadius(item.liveGps.accuracy || 25);
    }

    if (!mapRef.distanceLine) {
      mapRef.distanceLine = window.L.polyline([photoLatLng, liveLatLng], {
        color: "#c95a3c",
        weight: 3,
        dashArray: "6 8",
      }).addTo(mapRef.map);
    } else {
      mapRef.distanceLine.setLatLngs([photoLatLng, liveLatLng]);
    }

    const bounds = window.L.latLngBounds([photoLatLng, liveLatLng]);
    mapRef.map.fitBounds(bounds.pad(0.25), { animate: true, maxZoom: 15 });
  }

  function geolocationErrorMessage(error) {
    if (error && error.code === error.PERMISSION_DENIED) {
      return "Live GPS permission was denied. You can still use the photo's embedded coordinates.";
    }
    if (error && error.code === error.POSITION_UNAVAILABLE) {
      return "Your current location is unavailable right now.";
    }
    if (error && error.code === error.TIMEOUT) {
      return "Live GPS took too long to respond. Try again in a moment.";
    }
    return "Press could not read live GPS from this browser.";
  }

  async function cleanSingleItem(id) {
    const item = findItem(id);
    if (!item) return;

    try {
      await cleanItem(item, { renderDuring: true });
      render();
      showToast("Metadata removed. Clean copy ready.", "success");
    } catch (error) {
      render();
      showToast(error.message || "Press could not clean this image.", "error");
    }
  }

  async function cleanAllItems(options = {}) {
    const cleanable = state.items.filter((item) => item.status !== "reading");

    if (!cleanable.length) {
      showToast("Add an image first, then Press can create clean copies.", "warning");
      return;
    }

    state.isBusy = true;
    let cleanedCount = 0;

    for (let index = 0; index < cleanable.length; index += 1) {
      const item = cleanable[index];
      state.batchMessage = `Cleaning ${index + 1} of ${cleanable.length}: ${item.file.name}`;
      render();
      try {
        await cleanItem(item, { renderDuring: false });
        cleanedCount += 1;
      } catch (error) {
        item.cleanNotice = error.message || "Press could not clean this image.";
      }
      await nextFrame();
    }

    state.isBusy = false;
    state.batchMessage = `${cleanedCount} clean cop${cleanedCount === 1 ? "y is" : "ies are"} ready. Your original files were not changed.`;
    render();

    if (!options.silent) {
      showToast(`Metadata removed from ${cleanedCount} image${cleanedCount === 1 ? "" : "s"}. Clean copies ready.`, "success");
    }
  }

  async function cleanItem(item, options = {}) {
    if (item.status === "reading") {
      throw new Error("Press is still reading this image. Try again in a moment.");
    }

    item.status = "cleaning";
    item.cleanNotice = "";
    if (options.renderDuring) render();

    const blob = await createCleanBlob(item.file);

    if (item.cleanedUrl) {
      URL.revokeObjectURL(item.cleanedUrl);
    }

    item.cleanedBlob = blob;
    item.cleanedUrl = URL.createObjectURL(blob);
    item.status = "cleaned";

    const originalExtension = getExtension(item.file.name);
    const wasConverted = !["jpg", "jpeg"].includes(originalExtension) && item.file.type !== "image/jpeg";
    item.cleanNotice = wasConverted
      ? "Converted to a high-quality JPEG so the browser can create a metadata-free copy."
      : "Re-rendered as a high-quality JPEG to strip embedded metadata.";
  }

  async function createCleanBlob(file) {
    const source = await decodeForCanvas(file);
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;

    if (!width || !height) {
      closeCanvasSource(source);
      throw new Error("Press could not read this image's pixel size.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });

    if (!context) {
      closeCanvasSource(source);
      throw new Error("Canvas is not available in this browser.");
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    closeCanvasSource(source);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Press could not export a clean image from Canvas."));
          }
        },
        "image/jpeg",
        0.94,
      );
    });
  }

  async function decodeForCanvas(file) {
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch (error) {
        return createImageBitmap(file);
      }
    }

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Press could not load this image in the browser."));
      };
      image.src = url;
    });
  }

  function closeCanvasSource(source) {
    if (source && typeof source.close === "function") {
      source.close();
    }
  }

  function downloadItem(item) {
    if (!item.cleanedBlob || !item.cleanedUrl) {
      showToast("Create a clean copy first, then it can be downloaded.", "warning");
      return;
    }

    triggerDownload(item.cleanedUrl, item.outputFileName);
    showToast(`${item.outputFileName} download started.`, "success");
  }

  async function downloadAllCleaned() {
    if (!state.items.length) {
      showToast("Add images first, then Press can prepare downloads.", "warning");
      return;
    }

    const uncleaned = state.items.filter((item) => !item.cleanedBlob && item.status !== "reading");
    if (uncleaned.length) {
      await cleanAllItems({ silent: true });
    }

    const cleaned = state.items.filter((item) => item.cleanedBlob);
    if (!cleaned.length) {
      showToast("No clean copies are ready yet.", "warning");
      return;
    }

    if (cleaned.length === 1) {
      downloadItem(cleaned[0]);
      return;
    }

    if (!window.JSZip) {
      cleaned.forEach(downloadItem);
      showToast("JSZip did not load, so Press downloaded clean files individually.", "warning");
      return;
    }

    state.isBusy = true;
    state.batchMessage = "Packing clean copies into a ZIP...";
    render();

    const zip = new window.JSZip();
    cleaned.forEach((item) => {
      zip.file(item.outputFileName, item.cleanedBlob);
    });

    const zipBlob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
      (metadata) => {
        state.batchMessage = `Packing ZIP: ${Math.round(metadata.percent)}%`;
        renderBatchActions();
      },
    );

    state.isBusy = false;
    state.batchMessage = "ZIP download ready. Clean copies stay in this browser until you clear them.";
    render();

    const url = URL.createObjectURL(zipBlob);
    triggerDownload(url, "press-cleaned-images.zip");
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("ZIP download started.", "success");
  }

  function triggerDownload(url, fileName) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function removeItem(id) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index === -1) return;

    const [item] = state.items.splice(index, 1);
    stopLiveGps(item, { silent: true });
    revokeItemUrls(item);
    state.batchMessage = state.items.length
      ? "Metadata removal creates a new cleaned copy. Your original file is not modified."
      : "Metadata removal creates a new cleaned copy. Your original file is not modified.";
    render();
    showToast(`${item.file.name} was removed from this session.`, "success");
  }

  function clearAllItems() {
    cleanupMaps();
    state.items.forEach((item) => stopLiveGps(item, { silent: true }));
    state.items.forEach(revokeItemUrls);
    state.items = [];
    state.batchMessage = "Metadata removal creates a new cleaned copy. Your original file is not modified.";
    render();
    showToast("Cleared this local Press session.", "success");
  }

  function revokeItemUrls(item) {
    if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
    if (item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
  }

  function initializeVisibleMaps() {
    document.querySelectorAll("[data-map-item]").forEach((container) => {
      const item = findItem(container.dataset.mapItem);
      if (!item || !item.gps || mapRefs.has(item.id) || !window.L) return;

      const map = window.L.map(container, {
        scrollWheelZoom: false,
        zoomControl: true,
      }).setView([item.gps.latitude, item.gps.longitude], 14);

      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const photoMarker = window.L.circleMarker([item.gps.latitude, item.gps.longitude], {
        radius: 9,
        color: "#075d52",
        fillColor: "#0e8f80",
        fillOpacity: 0.95,
        weight: 3,
      })
        .addTo(map)
        .bindPopup("Photo GPS location");

      const mapRef = {
        map,
        photoMarker,
        liveMarker: null,
        accuracyCircle: null,
        distanceLine: null,
      };
      mapRefs.set(item.id, mapRef);
      if (item.liveGps) {
        updateLiveGpsOnMap(item);
      }
      window.setTimeout(() => map.invalidateSize(), 120);
    });
  }

  function cleanupMaps() {
    mapRefs.forEach((entry) => entry.map.remove());
    mapRefs.clear();
  }

  async function handleLoveSubmit(event) {
    event.preventDefault();
    const rawName = elements.loveName.value.trim();
    const name = rawName || "A local fan";
    const note = (elements.loveNote ? elements.loveNote.value.trim() : "") || "I love you, Press!";
    const displayMessage = `I love you, Press \u2014 from ${name} \u{1F499}`;
    const submitButton = elements.loveForm.querySelector("button[type='submit']");

    submitButton.disabled = true;
    elements.loveMessage.textContent = "Sending your note...";
    showToast("Sending your note...", "info");

    try {
      if (elements.lovePageUrl) {
        elements.lovePageUrl.value = window.location.href;
      }

      const formData = new FormData(elements.loveForm);
      const payload = Object.fromEntries(formData);
      payload.access_key = web3FormsAccessKey;
      payload.subject = "New Press love message";
      payload.from_name = "Press";
      payload.name = name;
      payload.message = note;
      payload.botcheck = false;
      payload.page_url = window.location.href;
      payload.press_animation_message = displayMessage;

      const response = await fetch(elements.loveForm.action || web3FormsEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Web3Forms did not accept the message.");
      }

      elements.loveMessage.textContent = displayMessage;
      saveLoveMessage(displayMessage);
      burstHearts();
      elements.loveForm.reset();
      showToast("Love sent. Thanks for the note.", "success");
    } catch (error) {
      elements.loveMessage.textContent = "Message could not be sent right now. Please try again later.";
      showToast("Message could not be sent right now. Please try again later.", "error");
    } finally {
      submitButton.disabled = false;
    }
  }

  function saveLoveMessage(message) {
    state.loveMessages.unshift({
      message,
      createdAt: Date.now(),
    });
    state.loveMessages = state.loveMessages.slice(0, 5);
    localStorage.setItem("press-love-messages", JSON.stringify(state.loveMessages));
    renderLoveMessages();
  }

  function loadLoveMessages() {
    try {
      state.loveMessages = JSON.parse(localStorage.getItem("press-love-messages") || "[]");
    } catch (error) {
      state.loveMessages = [];
    }
  }

  function renderLoveMessages() {
    if (!elements.loveList) return;

    elements.loveList.innerHTML = state.loveMessages
      .map((entry) => `<li>${escapeHtml(entry.message)}</li>`)
      .join("");
  }

  function burstHearts() {
    const count = 12;
    for (let index = 0; index < count; index += 1) {
      const heart = document.createElement("span");
      heart.className = "heart";
      heart.textContent = "\u2665";
      heart.style.left = `${12 + Math.random() * 76}%`;
      heart.style.animationDelay = `${Math.random() * 220}ms`;
      heart.style.color = index % 3 === 0 ? "#0e8f80" : index % 3 === 1 ? "#1c6dd0" : "#c95a3c";
      elements.heartLayer.append(heart);
      window.setTimeout(() => heart.remove(), 1600);
    }
  }

  function extractGps(raw) {
    if (!raw || typeof raw !== "object") return null;

    const latitude = parseCoordinate(
      pick(raw, ["latitude", "GPSLatitude", "GPS Latitude"]),
      pick(raw, ["GPSLatitudeRef", "GPS Latitude Ref"]),
    );
    const longitude = parseCoordinate(
      pick(raw, ["longitude", "GPSLongitude", "GPS Longitude"]),
      pick(raw, ["GPSLongitudeRef", "GPS Longitude Ref"]),
    );

    if (!isValidCoordinate(latitude, "lat") || !isValidCoordinate(longitude, "lon")) {
      return null;
    }

    return {
      latitude,
      longitude,
      altitude: formatAltitude(pick(raw, ["GPSAltitude", "GPS Altitude"]), pick(raw, ["GPSAltitudeRef", "GPS Altitude Ref"])),
      timestamp: formatGpsTimestamp(
        pick(raw, ["GPSDateStamp", "GPS Date Stamp"]),
        pick(raw, ["GPSTimeStamp", "GPS Time Stamp"]),
      ),
    };
  }

  function parseCoordinate(value, reference) {
    if (value == null || value === "") return null;

    let decimal = null;

    if (typeof value === "number") {
      decimal = value;
    } else if (Array.isArray(value)) {
      const parts = value.map(toNumber).filter((part) => Number.isFinite(part));
      if (parts.length >= 3) {
        decimal = Math.abs(parts[0]) + parts[1] / 60 + parts[2] / 3600;
      } else if (parts.length === 1) {
        decimal = parts[0];
      }
    } else if (typeof value === "string") {
      const decimalCandidate = Number(value);
      if (Number.isFinite(decimalCandidate)) {
        decimal = decimalCandidate;
      } else {
        const matches = value.match(/-?\d+(?:\.\d+)?/g);
        if (matches && matches.length >= 3) {
          const parts = matches.map(Number);
          decimal = Math.abs(parts[0]) + parts[1] / 60 + parts[2] / 3600;
          if (parts[0] < 0) decimal *= -1;
        }
      }
    }

    if (!Number.isFinite(decimal)) return null;

    const ref = String(reference || "").trim().toUpperCase();
    if (ref === "S" || ref === "W") {
      decimal = -Math.abs(decimal);
    }

    return decimal;
  }

  function isValidCoordinate(value, type) {
    if (!Number.isFinite(value)) return false;
    if (type === "lat") return value >= -90 && value <= 90;
    return value >= -180 && value <= 180;
  }

  function getRawRows(item) {
    if (item.rawRows) return item.rawRows;

    const fileRows = [
      { key: "File.Name", value: item.file.name },
      { key: "File.Type", value: prettyFileType(item.file) },
      { key: "File.Size", value: formatBytes(item.file.size) },
      { key: "File.LastModified", value: item.file.lastModified ? formatDate(item.file.lastModified) : "Unavailable" },
    ];

    if (item.dimensions) {
      fileRows.push({ key: "File.Width", value: `${item.dimensions.width}px` });
      fileRows.push({ key: "File.Height", value: `${item.dimensions.height}px` });
    }

    const exifRows = flattenMetadata(item.rawMetadata || {}).map((entry) => ({
      key: `EXIF.${entry.key}`,
      value: entry.value,
    }));

    item.rawRows = [...fileRows, ...exifRows];
    return item.rawRows;
  }

  function flattenMetadata(input, prefix = "", rows = [], seen = new WeakSet()) {
    if (!input || typeof input !== "object") return rows;
    if (seen.has(input)) {
      rows.push({ key: prefix || "Circular", value: "[Circular reference]" });
      return rows;
    }

    seen.add(input);

    Object.keys(input)
      .sort((a, b) => a.localeCompare(b))
      .forEach((key) => {
        const value = input[key];
        const path = prefix ? `${prefix}.${key}` : key;

        if (value === undefined || typeof value === "function") return;

        if (isExpandable(value)) {
          flattenMetadata(value, path, rows, seen);
        } else {
          rows.push({ key: path, value: formatRawValue(value) });
        }
      });

    return rows;
  }

  function isExpandable(value) {
    if (!value || typeof value !== "object") return false;
    if (value instanceof Date) return false;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return false;
    if (Array.isArray(value)) {
      return value.some((entry) => entry && typeof entry === "object" && !(entry instanceof Date));
    }
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function formatRawValue(value) {
    if (value == null) return "Unavailable";
    if (value instanceof Date) return formatDate(value);
    if (value instanceof ArrayBuffer) return `[Binary data, ${value.byteLength} bytes]`;
    if (ArrayBuffer.isView(value)) return `[Binary data, ${value.byteLength} bytes]`;
    if (Array.isArray(value)) return value.map(formatRawValue).join(", ");
    if (typeof value === "number") return formatNumber(value, 6);
    if (typeof value === "boolean") return value ? "Yes" : "No";

    const text = String(value);
    return text.length > 700 ? `${text.slice(0, 700)}...` : text;
  }

  function row(label, value, help, missingMessage = missingText) {
    const displayValue = normalizeDisplayValue(value);
    return {
      label,
      value: displayValue || "",
      missing: !displayValue,
      missingMessage,
      help,
    };
  }

  function normalizeDisplayValue(value) {
    if (value == null || value === "") return "";
    if (value instanceof Date) return formatDate(value);
    if (Array.isArray(value)) return value.map(normalizeDisplayValue).filter(Boolean).join(", ");
    if (typeof value === "number") return formatNumber(value, 4);
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return formatRawValue(value);
    return String(value);
  }

  function pick(object, keys) {
    if (!object || typeof object !== "object") return null;
    const objectKeys = Object.keys(object);

    for (const key of keys) {
      if (object[key] != null && object[key] !== "") return object[key];
      const found = objectKeys.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (found && object[found] != null && object[found] !== "") return object[found];
    }

    return null;
  }

  function getRowValue(rows, label) {
    const found = rows.find((entry) => entry.label === label);
    return found && !found.missing ? found.value : "";
  }

  function hasMeaningfulMetadata(item) {
    return Object.keys(item.rawMetadata || {}).length > 0;
  }

  function hasCameraInfo(item) {
    const raw = item.rawMetadata || {};
    return Boolean(
      pick(raw, ["Make", "Model", "LensModel", "FNumber", "ISO", "ExposureTime", "FocalLength"]),
    );
  }

  function formatFocalLength(value) {
    if (value == null || value === "") return null;
    const number = toNumber(value);
    if (Number.isFinite(number)) return `${formatNumber(number, 2)} mm`;
    const text = String(value);
    return /mm/i.test(text) ? text : `${text} mm`;
  }

  function formatAperture(value) {
    if (value == null || value === "") return null;
    const number = toNumber(value);
    if (Number.isFinite(number)) return `f/${formatNumber(number, 2)}`;
    const text = String(value);
    return text.startsWith("f/") ? text : `f/${text}`;
  }

  function formatExposure(value) {
    if (value == null || value === "") return null;
    const number = toNumber(value);
    if (!Number.isFinite(number) || number <= 0) return normalizeDisplayValue(value);
    if (number < 1) return `1/${Math.round(1 / number)} sec`;
    return `${formatNumber(number, 3)} sec`;
  }

  function formatFlash(value) {
    if (value == null || value === "") return null;
    if (typeof value === "object" && !Array.isArray(value)) {
      const text = Object.entries(value)
        .map(([key, entry]) => `${key}: ${normalizeDisplayValue(entry)}`)
        .join(", ");
      return text || null;
    }
    return normalizeDisplayValue(value);
  }

  function formatWhiteBalance(value) {
    if (value == null || value === "") return null;
    if (value === 0 || value === "0") return "Auto";
    if (value === 1 || value === "1") return "Manual";
    return normalizeDisplayValue(value);
  }

  function formatOrientation(value) {
    const orientationMap = {
      1: "Normal",
      2: "Mirrored horizontally",
      3: "Rotated 180 degrees",
      4: "Mirrored vertically",
      5: "Mirrored horizontally then rotated 270 degrees",
      6: "Rotated 90 degrees clockwise",
      7: "Mirrored horizontally then rotated 90 degrees",
      8: "Rotated 270 degrees clockwise",
    };
    if (value == null || value === "") return null;
    return orientationMap[value] || normalizeDisplayValue(value);
  }

  function formatBitDepth(value) {
    if (value == null || value === "") return null;
    if (Array.isArray(value)) {
      const unique = [...new Set(value.map(toNumber).filter(Number.isFinite))];
      if (unique.length === 1) return `${unique[0]} bits per channel`;
    }
    const number = toNumber(value);
    if (Number.isFinite(number)) return `${formatNumber(number, 0)} bit${number === 1 ? "" : "s"}`;
    return normalizeDisplayValue(value);
  }

  function formatAltitude(value, ref) {
    if (value == null || value === "") return "";
    const number = toNumber(value);
    if (!Number.isFinite(number)) return normalizeDisplayValue(value);
    const belowSeaLevel = String(ref || "").trim() === "1";
    return `${belowSeaLevel ? "-" : ""}${formatNumber(Math.abs(number), 2)} m`;
  }

  function formatGpsTimestamp(dateStamp, timeStamp) {
    if (!dateStamp && !timeStamp) return "";
    const date = formatDateValue(dateStamp);

    if (Array.isArray(timeStamp)) {
      const parts = timeStamp.map(toNumber);
      if (parts.every(Number.isFinite)) {
        const time = parts
          .map((part, index) => (index === 2 ? formatNumber(part, 3) : String(Math.trunc(part)).padStart(2, "0")))
          .join(":");
        return compactJoin([date, time], " ");
      }
    }

    return compactJoin([date, normalizeDisplayValue(timeStamp)], " ");
  }

  function formatDateValue(value) {
    if (value == null || value === "") return "";
    if (value instanceof Date) return formatDate(value);
    const text = String(value);
    const exifDate = text.match(/^(\d{4}):(\d{2}):(\d{2})(.*)$/);
    if (exifDate) {
      return `${exifDate[1]}-${exifDate[2]}-${exifDate[3]}${exifDate[4] || ""}`;
    }
    return text;
  }

  function formatDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function formatCoordinate(value) {
    return `${formatNumber(value, 6)}°`;
  }

  function distanceBetween(lat1, lon1, lat2, lon2) {
    const radius = 6371000;
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);
    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "an unknown distance";
    if (meters < 1000) return `${formatNumber(meters, 0)} m`;
    return `${formatNumber(meters / 1000, 2)} km`;
  }

  function formatNumber(value, maximumFractionDigits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits,
    }).format(number);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "Unknown size";
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${formatNumber(value, value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function prettyFileType(file) {
    if (file.type === "image/jpeg") return "JPEG image";
    if (file.type === "image/png") return "PNG image";
    if (file.type === "image/webp") return "WebP image";
    const extension = getExtension(file.name);
    return extension ? `${extension.toUpperCase()} image` : "Image file";
  }

  function toNumber(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value);
    if (value && typeof value === "object") {
      if (typeof value.valueOf === "function") {
        const number = Number(value.valueOf());
        if (Number.isFinite(number)) return number;
      }
      if ("numerator" in value && "denominator" in value) {
        return Number(value.numerator) / Number(value.denominator);
      }
    }
    return Number.NaN;
  }

  function compactJoin(parts, separator = " ") {
    return parts.filter(Boolean).join(separator);
  }

  function getExtension(fileName) {
    const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function makeCleanedFileName(fileName) {
    const base = String(fileName || "image").replace(/\.[^/.]+$/, "") || "image";
    const safeBase = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim() || "image";
    return `${safeBase}_cleaned-by-press.jpg`;
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `press-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function findItem(id) {
    return state.items.find((item) => item.id === id);
  }

  function addNotice(message) {
    state.notices.push({ id: createId(), message });
    state.notices = state.notices.slice(-6);
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.dataset.type = type;

    const icon =
      type === "success"
        ? "check-circle-2"
        : type === "warning"
          ? "circle-alert"
          : type === "error"
            ? "triangle-alert"
            : "info";

    toast.innerHTML = `<i data-lucide="${icon}"></i><span>${escapeHtml(message)}</span>`;
    toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
    elements.toastRegion.append(toast);
    refreshIcons();

    window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-12px) scale(0.98)";
      window.setTimeout(() => toast.remove(), 220);
    }, 6200);
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({
        attrs: {
          "aria-hidden": "true",
          focusable: "false",
        },
      });
    }
  }

  function nextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      };
      return entities[character];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
