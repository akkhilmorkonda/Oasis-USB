/**
 * Oasis Patient Health Key — FHIR Bundle Viewer
 * Loads fhir/bundle.json and renders a read-only patient record.
 */

(function () {
  const BUNDLE_PATH = 'fhir/bundle.json';

  const $ = (id) => document.getElementById(id);

  function showLoading() {
    $('loading').hidden = false;
    $('error').hidden = true;
    $('viewer').hidden = true;
  }

  function showError() {
    $('loading').hidden = true;
    $('error').hidden = false;
    $('viewer').hidden = true;
  }

  function showViewer() {
    $('loading').hidden = true;
    $('error').hidden = true;
    $('viewer').hidden = false;
  }

  function formatDate(str) {
    if (!str) return '—';
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatDateTime(str) {
    if (!str) return '—';
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getPatientName(patient) {
    if (!patient || !patient.name || patient.name.length === 0) return '—';
    const n = patient.name[0];
    const parts = (n.given || []).concat(n.family ? [n.family] : []);
    return parts.join(' ') || '—';
  }

  function getTelecom(patient) {
    if (!patient || !patient.telecom) return null;
    const phone = patient.telecom.find((t) => t.system === 'phone');
    return phone ? phone.value : null;
  }

  function renderPatient(patient) {
    const name = getPatientName(patient);
    const dob = formatDate(patient?.birthDate);
    const sex = patient?.gender || '—';
    const phone = getTelecom(patient);
    const id = patient?.id || '—';

    $('patient-name').textContent = name;
    $('patient-id').textContent = `ID: ${id}`;

    let html = `
      <div class="card__row"><span class="card__label">Name</span><span class="card__value">${escapeHtml(name)}</span></div>
      <div class="card__row"><span class="card__label">DOB</span><span class="card__value">${escapeHtml(dob)}</span></div>
      <div class="card__row"><span class="card__label">Sex</span><span class="card__value">${escapeHtml(sex)}</span></div>
    `;
    if (phone) {
      html += `<div class="card__row"><span class="card__label">Phone</span><span class="card__value">${escapeHtml(phone)}</span></div>`;
    }
    $('patient-summary').innerHTML = html;
  }

  function getEncounterId(resource) {
    const ref = resource.encounter?.reference || resource.context?.encounter?.reference;
    if (ref) return ref.replace(/^Encounter\//, '');
    if (Array.isArray(resource.context?.encounter)) {
      const first = resource.context.encounter[0];
      return first?.reference?.replace(/^Encounter\//, '');
    }
    const id = resource.id || '';
    const m = id.match(/-(?:bp|hr|temp|cond)-(\d+)$/) || id.match(/^cond-(\d+)$/);
    return m ? `enc-${m[1]}` : null;
  }

  function getObservationDisplay(obs) {
    const label = obs.code?.text || obs.code?.coding?.[0]?.display || 'Observation';
    let value = '—';
    let unit = '';

    if (obs.valueQuantity) {
      value = obs.valueQuantity.value;
      unit = obs.valueQuantity.unit || '';
    } else if (obs.component && obs.component.length > 0) {
      const sys = obs.component.find((c) => c.code?.text === 'Systolic')?.valueQuantity?.value;
      const dia = obs.component.find((c) => c.code?.text === 'Diastolic')?.valueQuantity?.value;
      if (sys != null && dia != null) {
        value = `${sys}/${dia}`;
        unit = obs.component[0]?.valueQuantity?.unit || 'mmHg';
      }
    }

    return { label, value, unit, date: obs.effectiveDateTime || obs.effectivePeriod?.start };
  }

  function renderMediaItem(resource) {
    const url = getMediaUrl(resource);
    const title = getMediaTitle(resource);
    const contentType = getMediaType(resource);
    let preview = '';
    if (!url) {
      preview = '<div class="media-card__missing">No URL specified</div>';
    } else if (contentType.startsWith('image/')) {
      preview = `
        <div class="media-card__preview">
          <img src="${escapeAttr(url)}" alt="${escapeAttr(title)}" onerror="this.parentElement.innerHTML='<div class=\\'media-card__missing\\'>Referenced media file not found.</div>'">
        </div>
      `;
    } else if (contentType.startsWith('audio/')) {
      preview = `
        <div class="media-card__preview">
          <audio controls src="${escapeAttr(url)}" onerror="this.parentElement.innerHTML='<div class=\\'media-card__missing\\'>Referenced media file not found.</div>'"></audio>
        </div>
      `;
    } else if (contentType.startsWith('video/')) {
      preview = `
        <div class="media-card__preview">
          <video controls src="${escapeAttr(url)}" onerror="this.parentElement.innerHTML='<div class=\\'media-card__missing\\'>Referenced media file not found.</div>'"></video>
        </div>
      `;
    } else {
      preview = `
        <div class="media-card__preview">
          <div class="media-card__missing">Referenced media file not found. (${escapeHtml(contentType || 'unknown')})</div>
        </div>
      `;
    }
    return `
      <div class="media-card">
        ${preview}
        <div class="media-card__body">
          <div class="media-card__title">${escapeHtml(title)}</div>
          <p class="media-card__meta">${escapeHtml(contentType || 'file')}</p>
        </div>
      </div>
    `;
  }

  function getMediaUrl(resource) {
    if (resource.resourceType === 'DocumentReference' && resource.content?.[0]?.attachment?.url) {
      return resource.content[0].attachment.url;
    }
    if (resource.resourceType === 'Media' && resource.content?.url) {
      return resource.content.url;
    }
    return null;
  }

  function getMediaTitle(resource) {
    if (resource.resourceType === 'DocumentReference') {
      return resource.content?.[0]?.attachment?.title || resource.description || 'Document';
    }
    if (resource.resourceType === 'Media') {
      return resource.content?.title || resource.type?.text || 'Media';
    }
    return 'Media';
  }

  function getMediaType(resource) {
    let ct = '';
    if (resource.resourceType === 'DocumentReference') {
      ct = resource.content?.[0]?.attachment?.contentType || '';
    } else if (resource.resourceType === 'Media') {
      ct = resource.content?.contentType || '';
    }
    return (ct || '').toLowerCase();
  }

  function renderVisits(encounters, observations, conditions, docs, mediaList) {
    if (!encounters || encounters.length === 0) {
      $('section-visits').hidden = true;
      return;
    }
    $('section-visits').hidden = false;

    const byEncounter = (arr, getEncId) => {
      const map = {};
      for (const r of arr || []) {
        const encId = getEncId(r);
        const key = encId || '_unlinked';
        if (!map[key]) map[key] = [];
        map[key].push(r);
      }
      return map;
    };
    const obsByEnc = byEncounter(observations, (r) => getEncounterId(r));
    const condByEnc = byEncounter(conditions, (r) => getEncounterId(r));
    const mediaItems = [...(docs || []), ...(mediaList || [])];
    const mediaByEnc = byEncounter(mediaItems, (r) => getEncounterId(r));

    const sortedEncounters = [...encounters].sort((a, b) => {
      const aT = a.period?.start || a.period?.end || '';
      const bT = b.period?.start || b.period?.end || '';
      return new Date(aT) - new Date(bT);
    });

    const html = sortedEncounters
      .map((e) => {
        const encId = e.id;
        const date = formatDateTime(e.period?.start || e.period?.end);
        const status = e.status || '—';
        const clinician = e.participant?.[0]?.individual?.display || '—';
        const type = e.type?.[0]?.text || e.class?.display || '—';

        const obsList = obsByEnc[encId] || [];
        const condList = condByEnc[encId] || [];
        const mediaListForVisit = mediaByEnc[encId] || [];

        let sections = `
          <div class="visit-card">
            <h3 class="visit-card__header">${escapeHtml(date)}</h3>
            <div class="card visit-card__encounter">
              <div class="card__row"><span class="card__label">Date</span><span class="card__value">${escapeHtml(date)}</span></div>
              <div class="card__row"><span class="card__label">Status</span><span class="card__value">${escapeHtml(status)}</span></div>
              <div class="card__row"><span class="card__label">Clinician</span><span class="card__value">${escapeHtml(clinician)}</span></div>
              <div class="card__row"><span class="card__label">Chief complaint</span><span class="card__value">${escapeHtml(type)}</span></div>
            </div>
        `;

        if (obsList.length > 0) {
          sections += `
            <h4 class="visit-card__subtitle">Vitals</h4>
            <div class="card-grid">
              ${obsList
                .map((obs) => {
                  const { label, value, unit, date: obsDate } = getObservationDisplay(obs);
                  return `
                    <div class="observation-card">
                      <div class="observation-card__label">${escapeHtml(label)}</div>
                      <div class="observation-card__value">${escapeHtml(String(value))} <span class="observation-card__unit">${escapeHtml(unit)}</span></div>
                      <div class="observation-card__date">${escapeHtml(formatDateTime(obsDate))}</div>
                    </div>
                  `;
                })
                .join('')}
            </div>
          `;
        }

        if (condList.length > 0) {
          sections += `
            <h4 class="visit-card__subtitle">Diagnosis</h4>
            <div class="card-grid">
              ${condList
                .map((c) => {
                  const text = c.code?.text || c.code?.coding?.[0]?.display || 'Condition';
                  const onset = c.onsetDateTime ? formatDate(c.onsetDateTime) : '';
                  return `
                    <div class="card">
                      <span class="condition-badge">${escapeHtml(text)}</span>
                      ${onset ? `<span class="observation-card__date">Since ${escapeHtml(onset)}</span>` : ''}
                    </div>
                  `;
                })
                .join('')}
            </div>
          `;
        }

        if (mediaListForVisit.length > 0) {
          sections += `
            <h4 class="visit-card__subtitle">Media</h4>
            <div class="media-grid">
              ${mediaListForVisit.map((r) => renderMediaItem(r)).join('')}
            </div>
          `;
        }

        sections += '</div>';
        return sections;
      })
      .join('');

    let unlinkedHtml = '';
    const unlinkedMedia = mediaByEnc['_unlinked'];
    if (unlinkedMedia && unlinkedMedia.length > 0) {
      unlinkedHtml = `
        <div class="visit-card">
          <h3 class="visit-card__header">Other media</h3>
          <div class="media-grid">
            ${unlinkedMedia.map((r) => renderMediaItem(r)).join('')}
          </div>
        </div>
      `;
    }

    $('visits-list').innerHTML = html + unlinkedHtml;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s ?? '';
    return div.innerHTML;
  }

  function escapeAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function parseAndRender(bundle) {
    if (!bundle || bundle.resourceType !== 'Bundle' || !bundle.entry) {
      showError();
      return;
    }

    const resources = bundle.entry.map((e) => e.resource).filter(Boolean);
    const patient = resources.find((r) => r.resourceType === 'Patient');

    if (!patient) {
      showError();
      return;
    }

    const encounters = resources.filter((r) => r.resourceType === 'Encounter');
    const observations = resources.filter((r) => r.resourceType === 'Observation');
    const conditions = resources.filter((r) => r.resourceType === 'Condition');
    const docs = resources.filter((r) => r.resourceType === 'DocumentReference');
    const media = resources.filter((r) => r.resourceType === 'Media');

    showViewer();
    renderPatient(patient);
    renderVisits(encounters, observations, conditions, docs, media);
  }

  function init() {
    showLoading();
    // Use embedded bundle if loaded via script tag (works from file://)
    if (typeof window.FHIR_BUNDLE !== 'undefined') {
      parseAndRender(window.FHIR_BUNDLE);
      return;
    }
    fetch(BUNDLE_PATH)
      .then((res) => {
        if (!res.ok) throw new Error('Bundle not found');
        return res.json();
      })
      .then(parseAndRender)
      .catch(() => showError());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
