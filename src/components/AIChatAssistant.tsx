import React, { useState, useRef, useEffect } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie
} from 'recharts';
import { 
  Sparkles, 
  X, 
  Send, 
  Bot, 
  User, 
  TrendingUp, 
  Printer, 
  Loader2, 
  BarChart3, 
  CheckCircle,
  AlertCircle,
  RefreshCw,
  HelpCircle,
  FileText
} from 'lucide-react';
import Markdown from 'react-markdown';
import { SpreadsheetData } from '../lib/sheets';

const CHART_COLORS = [
  '#4f46e5', // Indigo
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#f97316', // Orange
  '#14b8a6', // Teal
];

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  chart?: {
    type: 'bar' | 'line' | 'pie' | 'area' | null;
    title: string;
    data: { name: string; value: number }[];
  } | null;
  report?: {
    title: string;
    metrics: { label: string; value: string }[];
    summary: string;
  } | null;
  timestamp: string;
}

interface AIChatAssistantProps {
  sheetData: SpreadsheetData | null;
}

const AIChatAssistantComponent: React.FC<AIChatAssistantProps> = ({ sheetData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // Attempt load from localStorage
    try {
      const saved = localStorage.getItem('erp_ai_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {}
    return [
      {
        role: 'model',
        content: `👋 Hello! I am your **AI Assistant**. 

I can analyze employees, department overtime metrics, payroll segments, or allowance totals. You can ask me questions or ask me to **generate customized reports and visual charts** in a single prompt!

Here are some things you can try asking:
- *"Which department has logged the most overtime hours?"*
- *"Generate a comprehensive overtime summary report"*
- *"Compare the overtime of top 5 workers in a bar chart"*
- *"Analyze food allowance costs for all employees"*`,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try {
      const savedWidth = localStorage.getItem('erp_ai_drawer_width');
      if (savedWidth) {
        const parsed = parseInt(savedWidth, 10);
        if (parsed >= 320 && parsed <= 1200) {
          return parsed;
        }
      }
    } catch (e) {}
    return 448; // Default width of the drawer
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 320 && newWidth <= window.innerWidth * 0.9) {
        setDrawerWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isResizing) {
      try {
        localStorage.setItem('erp_ai_drawer_width', String(drawerWidth));
      } catch (e) {}
    }
  }, [drawerWidth, isResizing]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  // Save chat history
  useEffect(() => {
    try {
      localStorage.setItem('erp_ai_chat_history', JSON.stringify(messages));
    } catch (e) {}
  }, [messages]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query) return;

    if (!textToSend) {
      setInput('');
    }
    setError(null);

    // Append user message
    const userMsg: ChatMessage = {
      role: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      // Prepare historical messages for Gemini context
      const chatHistory = updatedMessages.map(m => ({
        role: m.role,
        content: m.content
      }));

      // Summarize sheetData into a lightweight compact payload for 10k+ scalability
      let compactData = null;
      if (sheetData) {
        const records = sheetData.records || [];
        const employees = sheetData.employees || [];

        let totalOTHours = 0;
        let totalFoodingCount = 0;
        const deptHours: Record<string, number> = {};
        const empHours: Record<string, { name: string; hours: number }> = {};

        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          const hrs = r.overtimeHours || 0;
          totalOTHours += hrs;
          totalFoodingCount += (r.foodingApplicable || 0);

          if (r.department) {
            deptHours[r.department] = (deptHours[r.department] || 0) + hrs;
          }
          if (r.employeeCode) {
            if (!empHours[r.employeeCode]) {
              empHours[r.employeeCode] = { name: r.employeeName, hours: 0 };
            }
            empHours[r.employeeCode].hours += hrs;
          }
        }

        const topOvertimeEarners = Object.entries(empHours)
          .sort((a, b) => b[1].hours - a[1].hours)
          .slice(0, 15)
          .map(([code, item]) => ({ code, name: item.name, totalOTHours: Math.round(item.hours * 10) / 10 }));

        const departmentSummary = Object.entries(deptHours).map(([dept, hours]) => ({
          department: dept,
          totalOTHours: Math.round(hours * 10) / 10
        }));

        const recentRecords = records.slice(-150).map(r => ({
          date: r.date,
          code: r.employeeCode,
          name: r.employeeName,
          dept: r.department,
          hours: r.overtimeHours,
          fooding: r.foodingApplicable > 0 ? "₹50 Flat" : "None",
          enteredBy: r.enteredBy,
          remarks: r.remarks
        }));

        compactData = {
          isCompact: true,
          totalRecordsCount: records.length,
          totalOTHours: Math.round(totalOTHours * 10) / 10,
          totalFoodingCount,
          departmentSummary,
          topOvertimeEarners,
          employees: employees.map(e => ({
            code: e.employeeCode,
            name: e.employeeName,
            dept: e.department,
            desg: e.designation,
            totalSalary: e.totalSalary
          })),
          recentRecords
        };
      }

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: chatHistory,
          currentData: compactData
        })
      });

      if (!response.ok) {
        throw new Error(`AI processing failed with status ${response.status}`);
      }

      const result = await response.json();
      
      const botMsg: ChatMessage = {
        role: 'model',
        content: result.reply || 'Analysis completed.',
        chart: result.chart && result.chart.type ? result.chart : null,
        report: result.report && result.report.title ? result.report : null,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (err: any) {
      console.error('AI Chat Error:', err);
      setError(err.message || 'Failed to connect to the Gemini AI API server.');
      // Append fallback warning
      setMessages(prev => [
        ...prev,
        {
          role: 'model',
          content: `⚠️ **System Alert**: I failed to process that request. This typically happens if the Gemini API key is missing or invalid in your configuration. 
          
Please make sure \`GEMINI_API_KEY\` is configured in your **Settings > Secrets** panel.`,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    if (window.confirm('Are you sure you want to clear chat history?')) {
      const resetMsg: ChatMessage[] = [
        {
          role: 'model',
          content: 'Chat history cleared. How can I assist you with overtime analysis now?',
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        }
      ];
      setMessages(resetMsg);
      localStorage.setItem('erp_ai_chat_history', JSON.stringify(resetMsg));
    }
  };

  // Render dynamic charts inside Chat
  const renderChart = (chart: NonNullable<ChatMessage['chart']>) => {
    if (!chart || !chart.type || !chart.data || chart.data.length === 0) return null;

    const data = chart.data;
    const type = chart.type;
    const title = chart.title;

    return (
      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mt-3 shadow-xs">
        <h4 className="text-[11px] font-semibold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
          {title}
        </h4>
        <div className="w-full h-44 text-[10px]">
          <ResponsiveContainer width="100%" height="100%">
            {type === 'bar' ? (
              <BarChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: '10px', borderRadius: '8px' }} />
                <Bar dataKey="value" fill="#4f46e5" radius={[4, 4, 0, 0]}>
                  {data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            ) : type === 'line' ? (
              <LineChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: '10px', borderRadius: '8px' }} />
                <Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            ) : type === 'area' ? (
              <AreaChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: '10px', borderRadius: '8px' }} />
                <defs>
                  <linearGradient id="aiAreaColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="value" stroke="#4f46e5" fillOpacity={1} fill="url(#aiAreaColor)" strokeWidth={1.5} />
              </AreaChart>
            ) : type === 'pie' ? (
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={30}
                  outerRadius={55}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: '10px', borderRadius: '8px' }} />
              </PieChart>
            ) : null}
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 text-[8px] font-medium text-slate-500">
          {data.slice(0, 8).map((d, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}></span>
              {d.name}: {d.value}
            </span>
          ))}
        </div>
      </div>
    );
  };

  // Generate formal printable reports
  const handlePrintReport = (report: NonNullable<ChatMessage['report']>) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>${report.title}</title>
          <style>
            body { font-family: 'Inter', system-ui, -apple-system, sans-serif; padding: 40px; color: #1e293b; background: white; line-height: 1.5; }
            .header { border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end; }
            .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0; }
            .subtitle { font-size: 12px; color: #64748b; margin-top: 5px; }
            .metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 35px; }
            .metric-card { border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; background-color: #f8fafc; }
            .metric-label { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; tracking-wider; margin-bottom: 6px; }
            .metric-value { font-size: 18px; font-weight: 700; color: #4f46e5; }
            .section-title { font-size: 14px; font-weight: 700; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 0.05em; }
            .summary-box { background: #fafafa; border: 1px solid #f1f5f9; border-radius: 10px; padding: 20px; font-size: 13px; color: #334155; }
            .stamp { text-align: right; margin-top: 50px; font-size: 11px; color: #94a3b8; }
            @media print {
              body { padding: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="title">${report.title}</h1>
              <p class="subtitle">AI Overtime Analyst Report • Verified Live ERP Context</p>
            </div>
            <div class="subtitle">Generated: ${new Date().toLocaleDateString('en-IN')}</div>
          </div>
          <div class="metrics-grid">
            ${(report.metrics || []).map(m => `
              <div class="metric-card">
                <div class="metric-label">${m.label}</div>
                <div class="metric-value">${m.value}</div>
              </div>
            `).join('')}
          </div>
          <div>
            <div class="section-title">Audit Insights & Summary</div>
            <div class="summary-box">${report.summary}</div>
          </div>
          <div class="stamp">
            Synced with Google Sheets Database • ERP Secure Session
          </div>
          <div style="margin-top: 40px; text-align: center;" class="no-print">
            <button onclick="window.print()" style="padding: 10px 20px; background: #0f172a; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">Print PDF Layout</button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const renderReport = (report: NonNullable<ChatMessage['report']>) => {
    if (!report || !report.title) return null;
    return (
      <div className="bg-slate-50 border border-indigo-100 rounded-xl p-5 mt-3 shadow-3xs border-l-4 border-l-indigo-600">
        <div className="flex justify-between items-start gap-4 mb-3">
          <div>
            <span className="text-[9px] font-semibold text-indigo-600 uppercase tracking-wider block">Generated Report</span>
            <h4 className="text-xs font-semibold text-slate-800 leading-tight">{report.title}</h4>
          </div>
          <button 
            onClick={() => handlePrintReport(report)}
            className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors shadow-3xs cursor-pointer flex items-center gap-1 text-[10px] font-semibold"
            title="Print PDF layout"
          >
            <Printer className="w-3.5 h-3.5 text-indigo-600" />
            PDF Format
          </button>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2.5 my-4">
          {report.metrics?.map((m, i) => (
            <div key={i} className="bg-white p-3 rounded-lg border border-slate-100 shadow-3xs">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-slate-400 mb-1">{m.label}</span>
              <span className="text-sm font-semibold text-slate-900 leading-none">{m.value}</span>
            </div>
          ))}
        </div>

        {/* Summary Description */}
        <div className="bg-white p-3.5 rounded-lg border border-slate-100 text-[11px] leading-relaxed text-slate-600 font-medium">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Executive Summary</span>
          {report.summary}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Floating Chat Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 bg-slate-900 hover:bg-black text-white p-3.5 rounded-full shadow-lg hover:shadow-xl transition-all cursor-pointer group flex items-center gap-2 hover:scale-105 active:scale-95 select-none animate-bounce"
        id="ai-agent-toggle-btn"
      >
        <Sparkles className="w-5 h-5 text-yellow-400 animate-pulse" />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 font-semibold text-xs whitespace-nowrap">
          AI Assistant
        </span>
      </button>

      {/* AI Drawer overlay slideout panel */}
      {isOpen && (
        <div className={`fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs select-none ${isResizing ? 'cursor-ew-resize' : ''}`}>
          <div className="absolute inset-0" onClick={() => setIsOpen(false)} />
          <div className="absolute inset-y-0 right-0 max-w-full flex">
            <div 
              style={{ width: `${drawerWidth}px` }}
              className="bg-white border-l border-slate-200 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300 relative select-text"
            >
              
              {/* Drag Handle to increase/decrease size */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizing(true);
                }}
                className={`absolute top-0 bottom-0 -left-1.5 w-3 cursor-ew-resize z-50 flex items-center justify-center transition-all ${
                  isResizing 
                    ? 'bg-indigo-500/20 border-l border-r border-indigo-500/30' 
                    : 'hover:bg-indigo-500/10'
                }`}
                title="Drag to resize AI Panel"
              >
                <div className={`w-[4px] h-12 rounded-full transition-colors ${
                  isResizing ? 'bg-indigo-600 shadow-xs' : 'bg-slate-300'
                }`} />
              </div>
              
              {/* Header */}
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="bg-slate-900 p-2 rounded-xl text-white">
                    <Sparkles className="w-4 h-4 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      AI Assistant
                    </h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span className="text-[9px] text-slate-400 font-medium">Online</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={clearChat}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer text-[10px] font-semibold"
                    title="Clear history"
                  >
                    Clear Chat
                  </button>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Chat Scroll Area */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-white select-text">
                {messages.map((m, index) => (
                  <div 
                    key={index} 
                    className={`flex gap-3 max-w-[88%] ${m.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
                  >
                    {/* Icon */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border select-none ${
                      m.role === 'user' 
                        ? 'bg-slate-50 border-slate-100 text-slate-700' 
                        : 'bg-indigo-50 border-indigo-100 text-indigo-600'
                    }`}>
                      {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>

                    {/* Bubble */}
                    <div className="space-y-1 w-full">
                      <div className={`rounded-2xl px-4 py-3 text-xs shadow-3xs leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-slate-900 text-white rounded-tr-none'
                          : 'bg-slate-50/80 border border-slate-100 text-slate-800 rounded-tl-none'
                      }`}>
                        <div className="prose text-xs text-inherit break-words">
                          <Markdown>{m.content}</Markdown>
                        </div>

                        {/* Render Dynamic Charts if provided */}
                        {m.chart && renderChart(m.chart)}

                        {/* Render Dynamic Reports if provided */}
                        {m.report && renderReport(m.report)}
                      </div>
                      
                      <span className={`block text-[8px] font-medium text-slate-400 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                        {m.timestamp}
                      </span>
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex gap-3 max-w-[88%]">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                    <div className="space-y-1">
                      <div className="bg-slate-50 border border-slate-100 rounded-2xl rounded-tl-none px-4 py-3 shadow-3xs flex items-center gap-2">
                        <span className="text-xs text-slate-400 font-medium animate-pulse">Running data analysis...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Suggestions chips */}
              {messages.length < 5 && (
                <div className="px-5 py-2.5 bg-slate-50 border-t border-b border-slate-100 flex flex-col gap-1.5">
                  <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider">Quick Prompts</span>
                  <div className="flex flex-wrap gap-1.5 select-none">
                    <button
                      onClick={() => handleSendMessage('Compare overtime hours by department')}
                      disabled={isLoading}
                      className="px-2.5 py-1 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-[10px] font-medium text-slate-600 transition-all cursor-pointer shadow-3xs"
                    >
                      Compare Departments Chart
                    </button>
                    <button
                      onClick={() => handleSendMessage('Generate an overtime summary report card')}
                      disabled={isLoading}
                      className="px-2.5 py-1 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-[10px] font-medium text-slate-600 transition-all cursor-pointer shadow-3xs"
                    >
                      Audit Report Card
                    </button>
                    <button
                      onClick={() => handleSendMessage('Who has the highest overtime logged and what are their remarks?')}
                      disabled={isLoading}
                      className="px-2.5 py-1 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-[10px] font-medium text-slate-600 transition-all cursor-pointer shadow-3xs"
                    >
                      Top OT Earners
                    </button>
                  </div>
                </div>
              )}

              {/* Input Form Footer */}
              <div className="p-4 border-t border-slate-100 bg-slate-50">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={isLoading}
                    placeholder="Ask AI, e.g. 'Compare IT vs Finance...'"
                    className="flex-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="bg-slate-900 hover:bg-black text-white p-2.5 rounded-xl cursor-pointer disabled:opacity-50 transition-all"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>

            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const AIChatAssistant = React.memo(AIChatAssistantComponent);
