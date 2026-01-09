// Pastikan library Supabase sudah load
const SUPABASE_URL = 'https://vspmleghlzxmhddoanbw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzcG1sZWdobHp4bWhkZG9hbmJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MjcxNDgsImV4cCI6MjA4MzUwMzE0OH0.0csh_5Z-FYro3rqyqlNtsEzkGJdga2iGw-I95loHhO8';

let supabaseClient;
try {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.error('Supabase client failed to init:', e);
}

// Global state
let allData = [];
let machines = [];
let oeeRecords = [];
let currentTab = 'dashboard';
let isAuthenticated = false;
let charts = {};
let currentMachine = null;

const defaultConfig = {
  app_title: 'OEE Manufacturing System',
  company_name: 'Real-time Production Monitoring & Analysis',
  background_color: '#f0f9ff',
  surface_color: '#ffffff',
  text_color: '#1e293b',
  primary_action_color: '#3b82f6',
  secondary_action_color: '#64748b'
};

// ========================================== 
// 1. HELPER FUNCTIONS
// ========================================== 

function showToast(message, type) {
  if (!type) type = 'success';
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3000);
}

function applyConfig(config) {
  const titleEl = document.getElementById('appTitle');
  if (titleEl) titleEl.textContent = config.app_title || defaultConfig.app_title;
  
  const compEl = document.getElementById('companyName');
  if (compEl) compEl.textContent = config.company_name || defaultConfig.company_name;
  
  const bgColor = config.background_color || defaultConfig.background_color;
  const surfaceColor = config.surface_color || defaultConfig.surface_color;
  const textColor = config.text_color || defaultConfig.text_color;
  const primaryColor = config.primary_action_color || defaultConfig.primary_action_color;
  const secondaryColor = config.secondary_action_color || defaultConfig.secondary_action_color;
  
  const appEl = document.getElementById('app');
  if (appEl) appEl.style.background = `linear-gradient(135deg, ${bgColor} 0%, ${surfaceColor} 100%)`;
  
  const style = document.createElement('style');
  style.textContent = `
    .tab-btn { background: ${surfaceColor}; color: ${textColor}; border: 1px solid #e2e8f0; }
    .tab-btn.active { background: ${primaryColor}; color: white; border-color: ${primaryColor}; }
    .tab-btn:hover:not(.active) { background: ${secondaryColor}; color: white; }
  `;
  document.head.appendChild(style);
}

// ========================================== 
// 2. CORE LOGIC FUNCTIONS
// ========================================== 

function updateDashboard() {
  const records = oeeRecords;
  
  if (records.length === 0) {
    if(document.getElementById('avgOeeStandard')) document.getElementById('avgOeeStandard').textContent = '0%';
    if(document.getElementById('totalOutput')) document.getElementById('totalOutput').textContent = '0';
    if(document.getElementById('avgOee365')) document.getElementById('avgOee365').textContent = '0%';
    return;
  }

  const avgOee = records.reduce((sum, r) => sum + (parseFloat(r.oee) || 0), 0) / records.length;
  const totalOut = records.reduce((sum, r) => sum + (parseInt(r.actual_output) || 0), 0);
  const avgOee365 = records.reduce((sum, r) => sum + (parseFloat(r.oee_365) || 0), 0) / records.length;

  document.getElementById('avgOeeStandard').textContent = `${avgOee.toFixed(1)}%`;
  document.getElementById('totalOutput').textContent = totalOut.toLocaleString();
  document.getElementById('avgOee365').textContent = `${avgOee365.toFixed(1)}%`;

  updateCharts(records);
  updateTables(records);
}

function updateCharts(records) {
  const sortedRecords = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last10 = sortedRecords.slice(-10);
  
  // OEE Trend - Standard vs 365
  if (charts.oeeTrend) charts.oeeTrend.destroy();
  const trendCtx = document.getElementById('oeeTrendChart')?.getContext('2d');
  if (trendCtx) {
    charts.oeeTrend = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: last10.map(r => r.date),
        datasets: [
          {
            label: 'OEE Standard',
            data: last10.map(r => r.oee),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
            fill: false
          },
          {
            label: 'OEE 365',
            data: last10.map(r => r.oee_365),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.4,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { 
          legend: { labels: { color: '#1e293b', font: { size: 12, weight: 'bold' } } }
        },
        scales: {
          y: { 
            ticks: { color: '#64748b', callback: function(value) { return value + '%'; } }, 
            grid: { color: '#e2e8f0' }, 
            min: 0, 
            max: 100 
          },
          x: { ticks: { color: '#64748b' }, grid: { color: '#e2e8f0' } }
        }
      }
    });
  }

  // OEE per Machine dengan target line
  const machineData = {};
  records.forEach(r => {
    if (!machineData[r.machine]) machineData[r.machine] = [];
    machineData[r.machine].push(parseFloat(r.oee));
  });
  const machineAvg = Object.entries(machineData).map(([m, vals]) => ({
    machine: m,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length
  }));

  if (charts.oeeMachine) charts.oeeMachine.destroy();
  const machineCtx = document.getElementById('oeeMachineChart')?.getContext('2d');
  if (machineCtx) {
    const targetLine = {
      id: 'targetLine',
      afterDraw: (chart) => {
        const ctx = chart.ctx;
        const yAxis = chart.scales.y;
        const targetY = yAxis.getPixelForValue(88);
        
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(chart.chartArea.left, targetY);
        ctx.lineTo(chart.chartArea.right, targetY);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        
        // Label target
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 12px Arial';
        ctx.fillText('Target: 88%', chart.chartArea.right - 80, targetY - 5);
        ctx.restore();
      }
    };

    charts.oeeMachine = new Chart(machineCtx, {
      type: 'bar',
      data: {
        labels: machineAvg.map(m => m.machine),
        datasets: [{
          label: 'Average OEE Standard',
          data: machineAvg.map(m => m.avg),
          backgroundColor: '#10b981',
          borderColor: '#047857',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { 
          legend: { labels: { color: '#1e293b', font: { size: 12, weight: 'bold' } } }
        },
        scales: {
          y: { 
            ticks: { 
              color: '#64748b', 
              callback: function(value) { return value + '%'; } 
            }, 
            grid: { color: '#e2e8f0' }, 
            min: 0, 
            max: 100 
          },
          x: { ticks: { color: '#64748b' }, grid: { color: '#e2e8f0' } }
        }
      },
      plugins: [targetLine]
    });
  }

  // A-P-Q Comparison
  const avgA = records.reduce((s, r) => s + (parseFloat(r.availability) || 0), 0) / records.length;
  const avgP = records.reduce((s, r) => s + (parseFloat(r.performance) || 0), 0) / records.length;
  const avgQ = records.reduce((s, r) => s + (parseFloat(r.quality) || 0), 0) / records.length;
  const avgA365 = records.reduce((s, r) => s + (parseFloat(r.availability_365) || 0), 0) / records.length;

  if (charts.apq) charts.apq.destroy();
  const apqCtx = document.getElementById('apqChart')?.getContext('2d');
  if (apqCtx) {
    charts.apq = new Chart(apqCtx, {
      type: 'bar',
      data: {
        labels: ['A (Std)', 'P (Std)', 'Q (Std)', 'A (365)'],
        datasets: [{
          label: 'Percentage',
          data: [avgA, avgP, avgQ, avgA365],
          backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { 
          legend: { display: false }
        },
        scales: {
          y: { 
            ticks: { 
              color: '#64748b', 
              callback: function(value) { return value + '%'; } 
            }, 
            grid: { color: '#e2e8f0' }, 
            beginAtZero: true, 
            max: 100 
          },
          x: { ticks: { color: '#64748b' }, grid: { color: '#e2e8f0' } }
        }
      }
    });
  }

  // Top 10 ODT
  const odtData = {};
  records.forEach(r => {
    const odtTimes = typeof r.odt_actual_times === 'string' ? JSON.parse(r.odt_actual_times) : r.odt_actual_times || {};
    Object.entries(odtTimes).forEach(([item, time]) => {
      odtData[item] = (odtData[item] || 0) + parseFloat(time);
    });
  });
  const top10Odt = Object.entries(odtData).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (charts.odtChart) charts.odtChart.destroy();
  const odtCtx = document.getElementById('odtChart')?.getContext('2d');
  if (odtCtx) {
    charts.odtChart = new Chart(odtCtx, {
      type: 'bar',
      data: {
        labels: top10Odt.map(([item]) => item),
        datasets: [{ 
          label: 'Total Minutes', 
          data: top10Odt.map(([, time]) => time), 
          backgroundColor: '#f59e0b' 
        }]
      },
      options: {
        responsive: true, 
        maintainAspectRatio: true, 
        indexAxis: 'y',
        plugins: { 
          legend: { display: false }
        },
        scales: { 
          y: { 
            ticks: { 
              color: '#64748b', 
              font: { size: 10 } 
            }, 
            grid: { color: '#e2e8f0' } 
          }, 
          x: { 
            ticks: { 
              color: '#64748b',
              callback: function(value) { return value + ' min'; }
            }, 
            grid: { color: '#e2e8f0' } 
          } 
        }
      }
    });
  }

  // Top 10 Line Stop Mesin
  const lsData = {};
  records.forEach(r => {
    const lsDurations = typeof r.line_stop_durations === 'string' ? JSON.parse(r.line_stop_durations) : r.line_stop_durations || {};
    const lsActions = typeof r.line_stop_actions === 'string' ? JSON.parse(r.line_stop_actions) : r.line_stop_actions || {};
    
    Object.entries(lsDurations).forEach(([item, duration]) => {
      // Cek apakah ini line stop mesin (bukan non-mesin atau ODT extra)
      const action = lsActions[item] || '';
      const isMesinStop = !item.includes('(Extra)') && 
                         (action.includes('MESIN') || 
                          action.includes('MACHINE') || 
                          !action.includes('MATERIAL') && !action.includes('OPERATOR'));
      
      if (isMesinStop) {
        lsData[item] = (lsData[item] || 0) + parseFloat(duration);
      }
    });
  });
  
  const top10LS = Object.entries(lsData).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (charts.lsChart) charts.lsChart.destroy();
  const lsCtx = document.getElementById('lsChart')?.getContext('2d');
  if (lsCtx) {
    charts.lsChart = new Chart(lsCtx, {
      type: 'bar',
      data: {
        labels: top10LS.map(([item]) => item.length > 20 ? item.substring(0, 20) + '...' : item),
        datasets: [{ 
          label: 'Total Minutes', 
          data: top10LS.map(([, duration]) => duration), 
          backgroundColor: '#ef4444' 
        }]
      },
      options: {
        responsive: true, 
        maintainAspectRatio: true, 
        indexAxis: 'y',
        plugins: { 
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const fullName = top10LS[context.dataIndex][0];
                return `${fullName}: ${context.parsed.x} min`;
              }
            }
          }
        },
        scales: { 
          y: { 
            ticks: { 
              color: '#64748b', 
              font: { size: 10 } 
            }, 
            grid: { color: '#e2e8f0' } 
          }, 
          x: { 
            ticks: { 
              color: '#64748b',
              callback: function(value) { return value + ' min'; }
            }, 
            grid: { color: '#e2e8f0' } 
          } 
        }
      }
    });
  }
}

function updateTables(records) {
  const sortedRecords = [...records].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Operator Performance
  const opData = {};
  sortedRecords.forEach(r => {
    if (!opData[r.pic]) opData[r.pic] = { output: 0, target: 0, records: [] };
    opData[r.pic].output += parseInt(r.actual_output) || 0;
    opData[r.pic].target += parseFloat(r.target_output) || 0;
    opData[r.pic].records.push(r);
  });

  const opHtml = Object.entries(opData).map(([op, data]) => {
    const pct = data.target > 0 ? ((data.output / data.target) * 100) : 0;
    const statusColor = pct < 100 ? 'text-red-600 font-bold' : 'text-green-600 font-bold';
    
    // Average Reduce Speed
    let totalRS = 0; 
    let rsCount = 0;
    data.records.forEach(r => {
      const machine = machines.find(m => m.name === r.machine);
      if (machine) {
        const odtTimes = typeof r.odt_actual_times === 'string' ? JSON.parse(r.odt_actual_times) : r.odt_actual_times || {};
        const totalOdt = Object.values(odtTimes).reduce((sum, val) => sum + parseFloat(val), 0);
        const lsDurations = typeof r.line_stop_durations === 'string' ? JSON.parse(r.line_stop_durations) : r.line_stop_durations || {};
        const totalLineStop = Object.values(lsDurations).reduce((sum, val) => sum + parseFloat(val), 0);
        const effectiveTime = parseFloat(r.work_time) - totalOdt - totalLineStop;
        const recommendation = parseFloat(machine.target_per_minute) * effectiveTime;
        if (recommendation > 0) {
          totalRS += ((parseFloat(r.actual_output) - recommendation) / recommendation) * 100;
          rsCount++;
        }
      }
    });
    const avgRS = rsCount > 0 ? totalRS / rsCount : 0;
    const rsColor = avgRS < 0 ? 'text-red-600 font-bold' : 'text-green-600 font-bold';
    
    return `
      <tr class="border-b border-slate-200">
        <td class="py-3 px-2 text-slate-700">${op}</td>
        <td class="py-3 px-2 text-right text-slate-700">${data.output.toLocaleString()}</td>
        <td class="py-3 px-2 text-right text-slate-700">${Math.round(data.target).toLocaleString()}</td>
        <td class="py-3 px-2 text-right ${statusColor}">${pct.toFixed(1)}%</td>
        <td class="py-3 px-2 text-right ${rsColor}">${avgRS > 0 ? '+' : ''}${avgRS.toFixed(1)}%</td>
      </tr>
    `;
  }).join('');
  
  if (document.getElementById('operatorTable')) {
    document.getElementById('operatorTable').innerHTML = opHtml || '<tr><td colspan="5" class="py-3 px-2 text-slate-500 text-center">No data</td></tr>';
  }

  // History
  const histHtml = sortedRecords.slice(0, 10).map(r => {
    const odtTimes = typeof r.odt_actual_times === 'string' ? JSON.parse(r.odt_actual_times) : r.odt_actual_times || {};
    const odtText = Object.entries(odtTimes).map(([item, time]) => `${item}: ${time}m`).join(', ') || '-';
    
    const lsDurations = typeof r.line_stop_durations === 'string' ? JSON.parse(r.line_stop_durations) : r.line_stop_durations || {};
    const lsText = Object.entries(lsDurations).map(([k, v]) => `${k.split(' - ')[1] || k}: ${v}m`).join(', ') || '-';

    // Minor Stop
    const minorStopData = typeof r.minor_stop_durations === 'string' ? JSON.parse(r.minor_stop_durations) : r.minor_stop_durations || {};
    const minorStopText = Object.entries(minorStopData).map(([item, duration]) => `${item}: ${duration}m`).join(', ') || '-';

    return `
      <tr class="border-b border-slate-200 ${parseFloat(r.oee) < 86 ? 'bg-red-50' : ''}">
        <td class="py-3 px-2 text-slate-700">${r.date}</td>
        <td class="py-3 px-2 text-slate-700">${r.shift}</td>
        <td class="py-3 px-2 text-slate-700">${r.machine}</td>
        <td class="py-3 px-2 text-slate-700">${r.pic}</td>
        <td class="py-3 px-2 text-right text-slate-700">${parseInt(r.actual_output).toLocaleString()}</td>
        <td class="py-3 px-2 text-right text-slate-700 font-semibold">${parseFloat(r.oee).toFixed(1)}%</td>
        <td class="py-3 px-2 text-right text-slate-700">${parseFloat(r.oee_365).toFixed(1)}%</td>
        <td class="py-3 px-2 text-slate-600 text-xs">${odtText}</td>
        <td class="py-3 px-2 text-slate-600 text-xs">${lsText}</td>
        <td class="py-3 px-2 text-slate-600 text-xs">${minorStopText}</td>
      </tr>
    `;
  }).join('');
  
  if (document.getElementById('historyTable')) {
    document.getElementById('historyTable').innerHTML = histHtml || '<tr><td colspan="10" class="py-3 px-2 text-slate-500 text-center">No data</td></tr>';
  }
}

function updateFilters() {
  const mNames = [...new Set(machines.map(m => m.name))];
  const ops = [...new Set(oeeRecords.map(r => r.pic))];
  
  if(document.getElementById('filterMachine')) {
    document.getElementById('filterMachine').innerHTML = '<option value="">All Machines</option>' + 
      mNames.map(m => `<option value="${m}">${m}</option>`).join('');
  }
  
  if(document.getElementById('filterOperator')) {
    document.getElementById('filterOperator').innerHTML = '<option value="">All Operators</option>' + 
      ops.map(o => `<option value="${o}">${o}</option>`).join('');
  }
}

function updateExportPreview() {
  const mNames = [...new Set(machines.map(m => m.name))];
  
  if(document.getElementById('exportMachine')) {
    document.getElementById('exportMachine').innerHTML = '<option value="">All Machines</option>' + 
      mNames.map(m => `<option value="${m}">${m}</option>`).join('');
  }

  const records = oeeRecords.slice(0, 10);
  const html = records.map(r => `
    <tr class="border-b border-slate-200">
      <td class="py-3 px-2 text-slate-700">${r.date}</td>
      <td class="py-3 px-2 text-slate-700">${r.shift}</td>
      <td class="py-3 px-2 text-slate-700">${r.machine}</td>
      <td class="py-3 px-2 text-slate-700">${r.pic}</td>
      <td class="py-3 px-2 text-right text-slate-700">${parseInt(r.actual_output).toLocaleString()}</td>
      <td class="py-3 px-2 text-right text-slate-700">${parseFloat(r.oee).toFixed(1)}%</td>
      <td class="py-3 px-2 text-right text-slate-700">${parseFloat(r.oee_365).toFixed(1)}%</td>
    </tr>
  `).join('');
  
  if(document.getElementById('exportPreview')) {
    document.getElementById('exportPreview').innerHTML = html || '<tr><td colspan="7" class="py-3 px-2 text-slate-500 text-center">No data</td></tr>';
  }
}

function updateMachineList() {
  const html = machines.map(m => `
    <div class="bg-blue-50 p-4 rounded-lg border border-blue-200 flex justify-between items-center mb-2">
      <div>
        <h4 class="font-bold">${m.name}</h4>
        <p class="text-sm">${m.area} | Target: ${m.target_per_minute}/min</p>
      </div>
      <div class="flex gap-2">
        <button onclick="editMachine('${m.id}')" class="bg-blue-600 text-white px-3 py-1 rounded">Edit</button>
        <button onclick="deleteMachine('${m.id}')" class="bg-red-600 text-white px-3 py-1 rounded">Delete</button>
      </div>
    </div>
  `).join('');
  
  const listEl = document.getElementById('machineList');
  if (listEl) {
    listEl.innerHTML = html || '<p>No machines</p>';
  }
}

// ========================================== 
// 3. MAIN LOGIC (ASYNC)
// ========================================== 

async function loadAllData() {
  try {
    if (!supabaseClient) {
      console.error('Supabase client not initialized');
      return;
    }
    
    const { data: machinesData, error: mError } = await supabaseClient.from('machines').select('*');
    const { data: recordsData, error: rError } = await supabaseClient.from('oee_records').select('*');

    if (mError) console.error('Machine load error:', mError);
    if (rError) console.error('Records load error:', rError);

    machines = machinesData || [];
    oeeRecords = recordsData || [];

    updateDashboard();
    updateFilters();
    updateExportPreview();
    updateMachineList();
  } catch (error) {
    console.error('Error loading data:', error);
    showToast('Failed to load data from database', 'error');
  }
}

async function init() {
  applyConfig(defaultConfig);
  await loadAllData();
}

// ========================================== 
// 4. EVENT HANDLERS
// ========================================== 

function switchTab(tab) {
  if (currentTab === 'machines' && tab !== 'machines') {
    lockMachineManagement();
  }
  
  currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  document.getElementById(`${tab}-tab`).classList.remove('hidden');
  document.getElementById(`tab-${tab}`).classList.add('active');
  
  if (tab === 'dashboard') {
    updateDashboard();
  } else if (tab === 'input') {
    loadMachineOptions();
  } else if (tab === 'machines') {
    updateAuthStatus();
    updateMachineList();
  } else if (tab === 'export') {
    updateExportPreview();
  }
}

function applyFilters() {
  const m = document.getElementById('filterMachine')?.value;
  const o = document.getElementById('filterOperator')?.value;
  const start = document.getElementById('filterStartDate')?.value;
  const end = document.getElementById('filterEndDate')?.value;

  let filtered = oeeRecords;
  if (m) filtered = filtered.filter(r => r.machine === m);
  if (o) filtered = filtered.filter(r => r.pic === o);
  if (start) filtered = filtered.filter(r => new Date(r.date) >= new Date(start));
  if (end) filtered = filtered.filter(r => new Date(r.date) <= new Date(end));

  updateDashboardWithData(filtered);
}

function updateDashboardWithData(data) {
  const records = data;
  if (records.length === 0) {
    document.getElementById('avgOeeStandard').textContent = '0%';
    document.getElementById('totalOutput').textContent = '0';
    document.getElementById('avgOee365').textContent = '0%';
    return;
  }
  
  const avgOee = records.reduce((sum, r) => sum + (parseFloat(r.oee) || 0), 0) / records.length;
  const totalOut = records.reduce((sum, r) => sum + (parseInt(r.actual_output) || 0), 0);
  const avgOee365 = records.reduce((sum, r) => sum + (parseFloat(r.oee_365) || 0), 0) / records.length;
  
  document.getElementById('avgOeeStandard').textContent = `${avgOee.toFixed(1)}%`;
  document.getElementById('totalOutput').textContent = totalOut.toLocaleString();
  document.getElementById('avgOee365').textContent = `${avgOee365.toFixed(1)}%`;
  
  updateCharts(records);
  updateTables(records);
}

function loadMachineOptions() {
  const inputMachine = document.getElementById('inputMachine');
  if (inputMachine) {
    inputMachine.innerHTML = '<option value="">Select Machine</option>' + 
      machines.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  }
}

function updateWorkTime() {
  const shift = document.getElementById('inputShift').value;
  const times = { 
    'SHIFT1': 510, 
    'SHIFT2': 450, 
    'SHIFT3': 510, 
    'LONGSHIFT_PAGI': 720, 
    'LONGSHIFT_MALAM': 720 
  };
  
  const liveWorkTime = document.getElementById('liveWorkTime');
  if (liveWorkTime) {
    liveWorkTime.textContent = `${times[shift] || 0} min`;
  }
  
  calculateOee();
}

function handleOdtCheck(checkbox) {
  const input = document.querySelector(`.odt-time[data-name="${checkbox.dataset.name}"]`);
  if(input) {
    input.disabled = !checkbox.checked;
    if (!checkbox.checked) input.value = '';
    calculateOee();
  }
}

function handleOdtTimeInput(input) {
  calculateOee();
}

function validateLineStopInput(input) {
  const duration = parseFloat(input.value) || 0;
  const name = input.dataset.item;
  
  const actionInput = document.querySelector(`[data-item="${name}"].ls-mesin-action`);
  const wrInput = document.querySelector(`[data-item="${name}"].ls-mesin-wr`);
  
  // Reset error styling
  actionInput?.classList.remove('border-red-500', 'ring-2', 'ring-red-200');
  wrInput?.classList.remove('border-red-500', 'ring-2', 'ring-red-200');
  
  // Tampilkan warning jika durasi >= 180
  if (duration >= 180) {
    if (wrInput) {
      wrInput.placeholder = "WR # WAJIB DIISI (≥180 menit)";
      wrInput.classList.add('border-yellow-500', 'bg-yellow-50');
    }
  } else {
    if (wrInput) {
      wrInput.placeholder = "WR #";
      wrInput.classList.remove('border-yellow-500', 'bg-yellow-50');
    }
  }
  
  calculateOee();
}

function loadMachineTemplate() {
  const name = document.getElementById('inputMachine').value;
  currentMachine = machines.find(m => m.name === name);
  if (!currentMachine) return;

  updateTargetRecommendation();

  // ODT Section
  const odtItems = typeof currentMachine.odt_items === 'string' ? JSON.parse(currentMachine.odt_items) : currentMachine.odt_items || [];
  let odtHtml = '<h3 class="text-slate-800 text-xl font-bold mb-4">ODT (Operator Delay Time)</h3><div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
  odtItems.forEach(item => {
    odtHtml += `
      <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <label class="flex items-center mb-2">
          <input type="checkbox" class="odt-check mr-2" data-name="${item.name}" data-standard="${item.standardTime}" onchange="handleOdtCheck(this)">
          <span class="text-slate-700 font-semibold">${item.name}</span>
          <span class="text-slate-500 text-sm ml-2">(Std: ${item.standardTime} min)</span>
        </label>
        <input type="number" class="odt-time w-full px-3 py-2 bg-white border border-slate-300 rounded text-slate-800" placeholder="Actual time (min)" min="0" data-name="${item.name}" data-standard="${item.standardTime}" oninput="handleOdtTimeInput(this)" disabled>
      </div>
    `;
  });
  
  const odtSection = document.getElementById('odtSection');
  if (odtSection) {
    odtSection.innerHTML = odtHtml + '</div>';
  }

  // LS Mesin dengan validation
  const lsMesin = typeof currentMachine.line_stop_mesin === 'string' ? JSON.parse(currentMachine.line_stop_mesin) : currentMachine.line_stop_mesin || [];
  let lsHtml = '<h3 class="text-slate-800 text-xl font-bold mb-4">Line Stop Mesin <span class="text-sm text-red-600">*Action wajib diisi, WR wajib jika ≥180 menit</span></h3><div class="space-y-4">';
  lsMesin.forEach(item => {
    lsHtml += `
      <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <div class="font-semibold text-slate-700 mb-2">${item}</div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div>
            <input type="number" class="ls-mesin-duration w-full px-3 py-2 bg-white border border-slate-300 rounded" placeholder="Durasi (min)" data-item="${item}" oninput="validateLineStopInput(this)">
            <div class="text-xs text-slate-500 mt-1">Durasi line stop</div>
          </div>
          <div>
            <input type="text" class="ls-mesin-action w-full px-3 py-2 bg-white border border-slate-300 rounded" placeholder="Action *WAJIB" data-item="${item}" oninput="this.value = this.value.toUpperCase()">
            <div class="text-xs text-red-600 mt-1">*Wajib diisi</div>
          </div>
          <div>
            <input type="text" class="ls-mesin-wr w-full px-3 py-2 bg-white border border-slate-300 rounded" placeholder="WR #" data-item="${item}" oninput="this.value = this.value.toUpperCase()">
            <div class="text-xs text-yellow-600 mt-1">Wajib jika ≥180 menit</div>
          </div>
        </div>
      </div>
    `;
  });
  
  const lineStopMesinSection = document.getElementById('lineStopMesinSection');
  if (lineStopMesinSection) {
    lineStopMesinSection.innerHTML = lsHtml + '</div>';
  }

  // LS Non Mesin dengan validation
  const lsNon = typeof currentMachine.line_stop_non_mesin === 'string' ? JSON.parse(currentMachine.line_stop_non_mesin) : currentMachine.line_stop_non_mesin || [];
  let lsNonHtml = '<h3 class="text-slate-800 text-xl font-bold mb-4">Line Stop Non Mesin <span class="text-sm text-red-600">*Action wajib diisi</span></h3><div class="space-y-4">';
  lsNon.forEach(item => {
    lsNonHtml += `
      <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <div class="font-semibold text-slate-700 mb-2">${item}</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <input type="number" class="ls-nonmesin-duration w-full px-3 py-2 bg-white border border-slate-300 rounded" placeholder="Durasi (min)" data-item="${item}" oninput="calculateOee()">
            <div class="text-xs text-slate-500 mt-1">Durasi line stop</div>
          </div>
          <div>
            <input type="text" class="ls-nonmesin-action w-full px-3 py-2 bg-white border border-slate-300 rounded" placeholder="Action *WAJIB" data-item="${item}" oninput="this.value = this.value.toUpperCase()">
            <div class="text-xs text-red-600 mt-1">*Wajib diisi</div>
          </div>
        </div>
      </div>
    `;
  });
  
  const lineStopNonMesinSection = document.getElementById('lineStopNonMesinSection');
  if (lineStopNonMesinSection) {
    lineStopNonMesinSection.innerHTML = lsNonHtml + '</div>';
  }

  // MINOR STOP Section
  const minorItems = typeof currentMachine.minor_stop_items === 'string' ? JSON.parse(currentMachine.minor_stop_items) : currentMachine.minor_stop_items || [];
  let minorHtml = '<h3 class="text-slate-800 text-xl font-bold mb-4">Minor Stop (< 10 menit)</h3><div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
  minorItems.forEach(item => {
    minorHtml += `
      <div class="bg-green-50 p-4 rounded-lg border border-green-200">
        <div class="font-semibold text-slate-700 mb-2">${item}</div>
        <input type="number" class="minor-stop-duration w-full px-3 py-2 bg-white border border-slate-300 rounded" placeholder="Total durasi (min)" max="10" data-item="${item}" oninput="calculateOee()">
        <div class="text-xs text-slate-500 mt-1">Minor stop (< 10 menit)</div>
      </div>
    `;
  });
  
  const minorStopSection = document.getElementById('minorStopSection');
  if (minorStopSection) {
    minorStopSection.innerHTML = minorHtml + '</div>';
  }

  calculateOee();
}

function updateTargetRecommendation() {
  if (!currentMachine) return;
  
  const shift = document.getElementById('inputShift').value;
  const workTime = { 
    'SHIFT1': 510, 
    'SHIFT2': 450, 
    'SHIFT3': 510, 
    'LONGSHIFT_PAGI': 720, 
    'LONGSHIFT_MALAM': 720 
  }[shift] || 0;
  
  let totalDowntime = 0;
  document.querySelectorAll('.odt-time:not(:disabled), .ls-mesin-duration, .ls-nonmesin-duration, .minor-stop-duration').forEach(i => {
    totalDowntime += (parseFloat(i.value) || 0);
  });
  
  const effectiveTime = workTime - totalDowntime;
  const recommendation = parseFloat(currentMachine.target_per_minute) * Math.max(0, effectiveTime);
  
  const outputRecommendation = document.getElementById('outputRecommendation');
  const timeLost = document.getElementById('timeLost');
  
  if (outputRecommendation) {
    outputRecommendation.textContent = `${Math.round(recommendation).toLocaleString()} pcs`;
  }
  
  if (timeLost) {
    timeLost.textContent = `${totalDowntime} min`;
  }
}

function calculateOee() {
  if (!currentMachine) return;
  
  updateTargetRecommendation();

  const shift = document.getElementById('inputShift').value;
  const workTime = { 
    'SHIFT1': 510, 
    'SHIFT2': 450, 
    'SHIFT3': 510, 
    'LONGSHIFT_PAGI': 720, 
    'LONGSHIFT_MALAM': 720 
  }[shift] || 0;
  
  const actualOutput = parseFloat(document.getElementById('inputOutput').value) || 0;
  const reject = parseFloat(document.getElementById('inputReject').value) || 0;

  let totalOdt = 0;
  let extraLineStop = 0;
  
  document.querySelectorAll('.odt-time:not(:disabled)').forEach(i => {
    const actualTime = parseFloat(i.value) || 0;
    const standardTime = parseFloat(i.dataset.standard) || 0;
    
    if (actualTime > standardTime) {
      totalOdt += standardTime;
      extraLineStop += (actualTime - standardTime);
    } else {
      totalOdt += actualTime;
    }
  });

  let totalLS = 0;
  document.querySelectorAll('.ls-mesin-duration, .ls-nonmesin-duration').forEach(i => {
    totalLS += (parseFloat(i.value) || 0);
  });
  
  // Tambahkan minor stop ke total downtime
  let totalMinorStop = 0;
  document.querySelectorAll('.minor-stop-duration').forEach(i => {
    totalMinorStop += (parseFloat(i.value) || 0);
  });
  
  totalLS += extraLineStop + totalMinorStop;

  const targetOutput = parseFloat(currentMachine.target_per_minute) * Math.max(0, workTime - totalOdt - totalLS);
  
  // Standard OEE Calculation
  const availability = workTime > totalOdt ? ((workTime - totalOdt - totalLS) / (workTime - totalOdt)) * 100 : 0;
  const performance = targetOutput > 0 ? (actualOutput / targetOutput) * 100 : 0;
  const quality = actualOutput > 0 ? ((actualOutput - reject) / actualOutput) * 100 : 0;
  const oee = (availability * performance * quality) / 10000;

  // OEE 365 Calculation
  const availability365 = workTime > 0 ? ((workTime - totalOdt - totalLS) / workTime) * 100 : 0;
  const performance365 = targetOutput > 0 ? (actualOutput / targetOutput) * 100 : 0;
  const quality365 = actualOutput > 0 ? ((actualOutput - reject) / actualOutput) * 100 : 0;
  const oee365 = (availability365 * performance365 * quality365) / 10000;

  const liveA = document.getElementById('liveA');
  const liveP = document.getElementById('liveP');
  const liveQ = document.getElementById('liveQ');
  const liveOEE = document.getElementById('liveOEE');
  const liveOEE365 = document.getElementById('liveOEE365');
  const liveA365 = document.getElementById('liveA365');
  
  if (liveA) liveA.textContent = `${availability.toFixed(1)}%`;
  if (liveP) liveP.textContent = `${performance.toFixed(1)}%`;
  if (liveQ) liveQ.textContent = `${quality.toFixed(1)}%`;
  if (liveOEE) liveOEE.textContent = `${oee.toFixed(1)}%`;
  if (liveOEE365) liveOEE365.textContent = `${oee365.toFixed(1)}%`;
  if (liveA365) liveA365.textContent = `${availability365.toFixed(1)}%`;
}

async function saveOeeRecord(e) {
  e.preventDefault();
  
  if (!currentMachine) {
    showToast('Select Machine', 'error');
    return;
  }

  const shift = document.getElementById('inputShift').value;
  const workTime = { 
    'SHIFT1': 510, 
    'SHIFT2': 450, 
    'SHIFT3': 510, 
    'LONGSHIFT_PAGI': 720, 
    'LONGSHIFT_MALAM': 720 
  }[shift] || 0;

  const odtTimes = {};
  const extraLineStop = {};
  
  document.querySelectorAll('.odt-time:not(:disabled)').forEach(i => {
    const actualTime = parseFloat(i.value) || 0;
    const standardTime = parseFloat(i.dataset.standard) || 0;
    const itemName = i.dataset.name;
    
    if (actualTime > 0) {
      if (actualTime > standardTime) {
        odtTimes[itemName] = standardTime;
        extraLineStop[`${itemName} (Extra)`] = (actualTime - standardTime);
      } else {
        odtTimes[itemName] = actualTime;
      }
    }
  });
  
  const lsDurations = {}; 
  const lsActions = {}; 
  const wrNums = {};
  const minorStopDurations = {};
  
  // VALIDASI LINE STOP MESIN
  let validationPassed = true;
  let validationErrors = [];
  
  document.querySelectorAll('.ls-mesin-duration').forEach(i => {
    const val = parseFloat(i.value) || 0;
    if (val > 0) {
      const name = i.dataset.item;
      lsDurations[name] = val;
      
      const actInput = document.querySelector(`[data-item="${name}"].ls-mesin-action`);
      const wrInput = document.querySelector(`[data-item="${name}"].ls-mesin-wr`);
      
      const action = actInput?.value || '';
      const wr = wrInput?.value || '';
      
      // VALIDASI 1: Action wajib diisi
      if (!action.trim()) {
        validationPassed = false;
        validationErrors.push(`Action harus diisi untuk "${name}"`);
        actInput?.classList.add('border-red-500', 'ring-2', 'ring-red-200');
      } else {
        actInput?.classList.remove('border-red-500', 'ring-2', 'ring-red-200');
        lsActions[name] = action;
      }
      
      // VALIDASI 2: WR wajib diisi jika durasi >= 180 menit
      if (val >= 180 && !wr.trim()) {
        validationPassed = false;
        validationErrors.push(`WR # wajib diisi untuk "${name}" (durasi ≥ 180 menit)`);
        wrInput?.classList.add('border-red-500', 'ring-2', 'ring-red-200');
      } else {
        wrInput?.classList.remove('border-red-500', 'ring-2', 'ring-red-200');
        if (wr.trim()) {
          wrNums[name] = wr;
        }
      }
    }
  });
  
  // VALIDASI LINE STOP NON MESIN
  document.querySelectorAll('.ls-nonmesin-duration').forEach(i => {
    const val = parseFloat(i.value) || 0;
    if (val > 0) {
      const name = i.dataset.item;
      lsDurations[name] = val;
      
      const actInput = document.querySelector(`[data-item="${name}"].ls-nonmesin-action`);
      const action = actInput?.value || '';
      
      // VALIDASI: Action wajib diisi
      if (!action.trim()) {
        validationPassed = false;
        validationErrors.push(`Action harus diisi untuk "${name}"`);
        actInput?.classList.add('border-red-500', 'ring-2', 'ring-red-200');
      } else {
        actInput?.classList.remove('border-red-500', 'ring-2', 'ring-red-200');
        lsActions[name] = action;
      }
    }
  });
  
  // MINOR STOP DATA
  document.querySelectorAll('.minor-stop-duration').forEach(i => {
    const val = parseFloat(i.value) || 0;
    if (val > 0) {
      const name = i.dataset.item;
      minorStopDurations[name] = val;
    }
  });
  
  // TAMPILKAN ERROR JIKA VALIDASI GAGAL
  if (!validationPassed) {
    const errorMsg = validationErrors.join('\n');
    showToast(`Validasi gagal:\n${errorMsg}`, 'error');
    return;
  }
  
  // TAMBAH EXTRA LINE STOP
  Object.entries(extraLineStop).forEach(([name, time]) => {
    lsDurations[name] = time;
    lsActions[name] = 'EXCESS ODT TIME';
  });

  const actualOutput = parseFloat(document.getElementById('inputOutput').value) || 0;
  const reject = parseFloat(document.getElementById('inputReject').value) || 0;

  let totalOdt = 0;
  Object.values(odtTimes).forEach(val => {
    totalOdt += parseFloat(val) || 0;
  });

  let totalLS = 0;
  Object.values(lsDurations).forEach(val => {
    totalLS += parseFloat(val) || 0;
  });

  let totalMinorStop = 0;
  Object.values(minorStopDurations).forEach(val => {
    totalMinorStop += parseFloat(val) || 0;
  });

  const totalDowntime = totalOdt + totalLS + totalMinorStop;
  const targetOutput = parseFloat(currentMachine.target_per_minute) * Math.max(0, workTime - totalDowntime);
  
  // Standard OEE Calculation
  const availability = workTime > totalOdt ? ((workTime - totalDowntime) / (workTime - totalOdt)) * 100 : 0;
  const performance = targetOutput > 0 ? (actualOutput / targetOutput) * 100 : 0;
  const quality = actualOutput > 0 ? ((actualOutput - reject) / actualOutput) * 100 : 0;
  const oee = (availability * performance * quality) / 10000;

  // OEE 365 Calculation
  const availability365 = workTime > 0 ? ((workTime - totalDowntime) / workTime) * 100 : 0;
  const performance365 = targetOutput > 0 ? (actualOutput / targetOutput) * 100 : 0;
  const quality365 = actualOutput > 0 ? ((actualOutput - reject) / actualOutput) * 100 : 0;
  const oee365 = (availability365 * performance365 * quality365) / 10000;

  const record = {
    date: document.getElementById('inputDate').value,
    shift: shift,
    machine: currentMachine.name,
    pic: document.getElementById('inputOperator').value,
    product: document.getElementById('inputProduct').value,
    batch: document.getElementById('inputBatch').value,
    actual_output: actualOutput,
    reject: reject,
    availability, 
    performance, 
    quality, 
    oee,
    availability_365: availability365,
    oee_365: oee365,
    odt_actual_times: odtTimes,
    line_stop_durations: lsDurations,
    line_stop_actions: lsActions,
    wr_numbers: wrNums,
    minor_stop_durations: minorStopDurations,
    work_time: workTime,
    target_output: targetOutput
  };

  const btn = document.getElementById('saveBtn');
  btn.disabled = true; 
  btn.innerHTML = 'Saving...';

  const { error } = await supabaseClient.from('oee_records').insert([record]);
  
  btn.disabled = false; 
  btn.innerHTML = 'Save OEE Record';

  if (!error) {
    showToast('Data OEE berhasil disimpan!');
    document.getElementById('oeeForm').reset();
    await loadAllData();
  } else {
    showToast('Error: ' + error.message, 'error');
  }
}

// Machine Management Auth
function authenticate() {
  if (document.getElementById('adminPassword').value === 'admin123') {
    isAuthenticated = true;
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('machineManagement').classList.remove('hidden');
    updateMachineList();
  } else {
    showToast('Wrong Password', 'error');
  }
}

function lockMachineManagement() {
  isAuthenticated = false;
  document.getElementById('authSection').classList.remove('hidden');
  document.getElementById('machineManagement').classList.add('hidden');
}

function updateAuthStatus() {
  const authStatus = document.getElementById('authStatus');
  if (authStatus) {
    authStatus.textContent = isAuthenticated ? '🔓 Unlocked' : '🔒 Locked';
  }
}

function showAddMachineForm() {
  document.getElementById('addMachineForm').classList.remove('hidden');
  document.getElementById('editMachineId').value = '';
}

function cancelMachineForm() {
  document.getElementById('addMachineForm').classList.add('hidden');
}

function addOdtRow() {
  const container = document.getElementById('odtItemsContainer');
  const row = document.createElement('div');
  row.className = 'grid grid-cols-12 gap-2 mb-2';
  row.innerHTML = `
    <input type="text" class="odt-item-name col-span-8 px-2 py-1 border" placeholder="Name">
    <input type="number" class="odt-item-time col-span-3 px-2 py-1 border" placeholder="Time">
    <button type="button" onclick="this.parentElement.remove()" class="col-span-1 text-red-500">×</button>
  `;
  container.appendChild(row);
}

function removeOdtRow(btn) {
  btn.parentElement.remove();
}

async function saveMachine(e) {
  e.preventDefault();
  const id = document.getElementById('editMachineId').value;
  
  const odtItems = [];
  document.querySelectorAll('#odtItemsContainer > div').forEach(row => {
    const n = row.querySelector('.odt-item-name').value;
    const t = row.querySelector('.odt-item-time').value;
    if (n && t) odtItems.push({ name: n, standardTime: parseInt(t) });
  });

  const machine = {
    name: document.getElementById('machineName').value.toUpperCase(),
    area: document.getElementById('machineArea').value,
    target_per_minute: parseFloat(document.getElementById('machineTarget').value),
    pic: document.getElementById('machinePic').value.toUpperCase(),
    odt_items: odtItems,
    line_stop_mesin: document.getElementById('machineLineStopMesin').value.split(',').map(s => s.trim()).filter(s => s),
    line_stop_non_mesin: document.getElementById('machineLineStopNonMesin').value.split(',').map(s => s.trim()).filter(s => s),
    minor_stop_items: document.getElementById('machineMinorStop').value.split(',').map(s => s.trim()).filter(s => s)
  };

  const btn = document.getElementById('saveMachineBtn');
  btn.disabled = true;

  let error;
  if (id) {
    ({ error } = await supabaseClient.from('machines').update(machine).eq('id', id));
  } else {
    ({ error } = await supabaseClient.from('machines').insert([machine]));
  }

  btn.disabled = false;
  if (!error) {
    showToast('Machine Saved');
    cancelMachineForm();
    await loadAllData();
  } else {
    showToast(error.message, 'error');
  }
}

async function deleteMachine(id) {
  if (confirm('Delete machine?')) {
    const { error } = await supabaseClient.from('machines').delete().eq('id', id);
    if (!error) {
      await loadAllData();
    } else {
      showToast(error.message, 'error');
    }
  }
}

function editMachine(id) {
  const m = machines.find(x => x.id === id);
  if (!m) return;
  
  showAddMachineForm();
  document.getElementById('editMachineId').value = m.id;
  document.getElementById('machineName').value = m.name;
  document.getElementById('machineArea').value = m.area;
  document.getElementById('machineTarget').value = m.target_per_minute;
  document.getElementById('machinePic').value = m.pic;
  
  const items = typeof m.odt_items === 'string' ? JSON.parse(m.odt_items) : m.odt_items || [];
  const container = document.getElementById('odtItemsContainer');
  container.innerHTML = '';
  
  items.forEach(it => {
    const row = document.createElement('div');
    row.className = 'grid grid-cols-12 gap-2 mb-2';
    row.innerHTML = `
      <input type="text" class="odt-item-name col-span-8 px-2 py-1 border" value="${it.name}">
      <input type="number" class="odt-item-time col-span-3 px-2 py-1 border" value="${it.standardTime}">
      <button type="button" onclick="this.parentElement.remove()" class="col-span-1 text-red-500">×</button>
    `;
    container.appendChild(row);
  });
  
  document.getElementById('machineLineStopMesin').value = (typeof m.line_stop_mesin === 'string' ? JSON.parse(m.line_stop_mesin) : m.line_stop_mesin || []).join(', ');
  document.getElementById('machineLineStopNonMesin').value = (typeof m.line_stop_non_mesin === 'string' ? JSON.parse(m.line_stop_non_mesin) : m.line_stop_non_mesin || []).join(', ');
  document.getElementById('machineMinorStop').value = (typeof m.minor_stop_items === 'string' ? JSON.parse(m.minor_stop_items) : m.minor_stop_items || []).join(', ');
}

function exportData(format) {
  const rows = [['Date', 'Shift', 'Machine', 'Operator', 'Actual Output', 'OEE', 'OEE (365)']];
  
  oeeRecords.forEach(r => {
    rows.push([
      r.date,
      r.shift,
      r.machine,
      r.pic,
      r.actual_output,
      `${r.oee}%`,
      `${r.oee_365}%`
    ]);
  });
  
  let csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "oee_data.csv");
  document.body.appendChild(link);
  link.click();
}

// ========================================== 
// 5. EXPOSE HELPERS TO WINDOW (FOR HTML ONCLICK)
// ========================================== 
window.switchTab = switchTab;
window.applyFilters = applyFilters;
window.saveOeeRecord = saveOeeRecord;
window.authenticate = authenticate;
window.showAddMachineForm = showAddMachineForm;
window.cancelMachineForm = cancelMachineForm;
window.saveMachine = saveMachine;
window.addOdtRow = addOdtRow;
window.removeOdtRow = removeOdtRow;
window.loadMachineTemplate = loadMachineTemplate;
window.updateWorkTime = updateWorkTime;
window.calculateOee = calculateOee;
window.handleOdtCheck = handleOdtCheck;
window.handleOdtTimeInput = handleOdtTimeInput;
window.validateLineStopInput = validateLineStopInput;
window.editMachine = editMachine;
window.deleteMachine = deleteMachine;
window.exportData = exportData;

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
