--!nocheck
--[[
	Roblox AI Builder – Roblox Studio Plugin

	Aufgabe:
	1. Verbindet Roblox Studio mit der Roblox AI Builder Web-App (Kopplungscode).
	2. Scannt die geöffnete Spielwelt (Workspace) und überträgt Geometrie- und Farbdaten.
	3. Empfängt die von der KI erzeugten, eigenen Modelle und fügt sie in den Workspace ein.
	4. Meldet den Baufortschritt an die Web-App.

	Installation:
	- Datei als "RobloxAIBuilder.lua" in den lokalen Roblox-Studio-Plugin-Ordner legen
	  (Studio: Reiter "Plugins" -> "Plugins Folder").
	- Roblox Studio neu starten.
	- In Studio: Home -> Game Settings -> Security -> "Allow HTTP Requests" aktivieren.
	- Plugin-Button "Nachbau-Panel" öffnen, Kopplungscode aus der Web-App eingeben.

	Es werden ausschließlich eigene Bauteile und eigene Skripte eingefügt.
]]

local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")

local plugin = script.Parent

local DEFAULT_BASE_URL = "__BASE_URL__"
local MAX_PARTS = 2000
local HEARTBEAT_SECONDS = 6
local POLL_SECONDS = 2
local BUILDER_FOLDER_PREFIX = "Roblox AI Builder"

local COLOR_TEXT = Color3.fromRGB(226, 232, 255)
local COLOR_MUTED = Color3.fromRGB(150, 160, 195)
local COLOR_OK = Color3.fromRGB(120, 220, 170)
local COLOR_WARN = Color3.fromRGB(255, 150, 140)
local COLOR_ACCENT = Color3.fromRGB(92, 108, 235)
local COLOR_PANEL = Color3.fromRGB(18, 20, 32)
local COLOR_INPUT = Color3.fromRGB(28, 32, 50)

local state = {
	baseUrl = plugin:GetSetting("baseUrl") or DEFAULT_BASE_URL,
	token = plugin:GetSetting("token"),
	userName = plugin:GetSetting("userName"),
	lastPartCount = 0,
	building = false,
	loopsStarted = false,
}

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------

local function create(className, properties, children)
	local instance = Instance.new(className)
	for key, value in pairs(properties or {}) do
		instance[key] = value
	end
	for _, child in ipairs(children or {}) do
		child.Parent = instance
	end
	return instance
end

local function round2(value)
	return math.floor(value * 100 + 0.5) / 100
end

local function normalizeUrl(value)
	local url = tostring(value or ""):gsub("%s", "")
	if url == "" then
		return DEFAULT_BASE_URL
	end
	if not string.find(url, "^https?://") then
		url = "https://" .. url
	end
	return (string.gsub(url, "/+$", ""))
end

local function isInBuilderFolder(instance)
	local node = instance
	while node and node ~= workspace do
		if node:IsA("Folder") and string.sub(node.Name, 1, #BUILDER_FOLDER_PREFIX) == BUILDER_FOLDER_PREFIX then
			return true
		end
		node = node.Parent
	end
	return false
end

-- ---------------------------------------------------------------------------
-- Oberfläche (DockWidget)
-- ---------------------------------------------------------------------------

local toolbar = plugin:CreateToolbar("Roblox AI Builder")
local openButton = toolbar:CreateButton("Nachbau-Panel", "Roblox AI Builder öffnen", "")
openButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 380, 560, 320, 380)
local widget = plugin:CreateDockWidgetPluginGui("RobloxAIBuilderPanel", widgetInfo)
widget.Title = "Roblox AI Builder"

local root = create("Frame", {
	Name = "Root",
	BackgroundColor3 = COLOR_PANEL,
	BorderSizePixel = 0,
	Size = UDim2.fromScale(1, 1),
})
root.Parent = widget

local scroll = create("ScrollingFrame", {
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	Position = UDim2.new(0, 10, 0, 10),
	Size = UDim2.new(1, -20, 1, -20),
	CanvasSize = UDim2.new(0, 0, 0, 0),
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	ScrollBarThickness = 6,
	ScrollBarImageColor3 = Color3.fromRGB(110, 120, 190),
})
scroll.Parent = root
create("UIListLayout", {
	Padding = UDim.new(0, 8),
	SortOrder = Enum.SortOrder.LayoutOrder,
}, { Parent = scroll })
create("UIPadding", {
	PaddingBottom = UDim.new(0, 12),
}, { Parent = scroll })

local function addLabel(text, height, textSize, bold, color)
	local label = create("TextLabel", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 0, height or 18),
		Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham,
		Text = text,
		TextColor3 = color or COLOR_TEXT,
		TextSize = textSize or 13,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		LayoutOrder = #scroll:GetChildren(),
	})
	label.Parent = scroll
	return label
end

local function addButton(text, height, color)
	local button = create("TextButton", {
		BackgroundColor3 = color or COLOR_ACCENT,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, height or 34),
		Font = Enum.Font.GothamBold,
		Text = text,
		TextColor3 = Color3.fromRGB(255, 255, 255),
		TextSize = 13,
		AutoButtonColor = true,
		LayoutOrder = #scroll:GetChildren(),
	}, {
		create("UICorner", { CornerRadius = UDim.new(0, 8) }),
	})
	button.Parent = scroll
	return button
end

local function addTextbox(placeholder, defaultText)
	local box = create("TextBox", {
		BackgroundColor3 = COLOR_INPUT,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, 32),
		Font = Enum.Font.Code,
		Text = defaultText or "",
		PlaceholderText = placeholder,
		PlaceholderColor3 = COLOR_MUTED,
		TextColor3 = COLOR_TEXT,
		TextSize = 13,
		ClearTextOnFocus = false,
		TextXAlignment = Enum.TextXAlignment.Left,
		LayoutOrder = #scroll:GetChildren(),
	}, {
		create("UICorner", { CornerRadius = UDim.new(0, 8) }),
		create("UIPadding", { PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8) }),
	})
	box.Parent = scroll
	return box
end

addLabel("Roblox AI Builder", 22, 17, true)
addLabel("KI-Nachbau direkt in Roblox Studio", 16, 12, false, COLOR_MUTED)

addLabel("1. Server-Adresse", 14, 12, true, COLOR_MUTED)
local urlBox = addTextbox("https://deine-app.example", state.baseUrl)

addLabel("2. Kopplungscode aus der Web-App", 14, 12, true, COLOR_MUTED)
local codeBox = addTextbox("z. B. K7M2QX", "")

local connectButton = addButton("Verbinden", 34)
local scanButton = addButton("Welt scannen", 34, Color3.fromRGB(58, 72, 150))
local disconnectButton = addButton("Verbindung trennen", 30, Color3.fromRGB(52, 56, 78))

local statusLabel = addLabel("Nicht verbunden", 16, 12, false, COLOR_WARN)
local logLabel = addLabel("", 60, 11, false, COLOR_MUTED)

-- ---------------------------------------------------------------------------
-- HTTP
-- ---------------------------------------------------------------------------

local function request(method, endpoint, body)
	local options = {
		Url = state.baseUrl .. endpoint,
		Method = method,
		Headers = { ["Content-Type"] = "application/json" },
	}
	if state.token then
		options.Headers["Authorization"] = "Bearer " .. state.token
	end
	if body ~= nil then
		options.Body = HttpService:JSONEncode(body)
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync(options)
	end)
	if not ok then
		return nil, "Keine Verbindung zum Server: " .. tostring(response)
	end
	if not response.Success then
		local message = response.Body
		local decoded
		local decodedOk = pcall(function()
			decoded = HttpService:JSONDecode(response.Body)
		end)
		if decodedOk and type(decoded) == "table" and decoded.message then
			message = decoded.message
		end
		return nil, string.format("HTTP %d – %s", response.StatusCode, tostring(message))
	end

	local decoded
	local decodedOk = pcall(function()
		decoded = HttpService:JSONDecode(response.Body)
	end)
	if not decodedOk then
		return nil, "Antwort konnte nicht gelesen werden"
	end
	return decoded, nil
end

local function setStatus(text, color)
	statusLabel.Text = text
	statusLabel.TextColor3 = color or COLOR_TEXT
end

local function log(text)
	logLabel.Text = text
end

-- ---------------------------------------------------------------------------
-- Welt scannen
-- ---------------------------------------------------------------------------

local function collectParts()
	local parts = {}
	for _, descendant in ipairs(workspace:GetDescendants()) do
		if #parts >= MAX_PARTS then
			break
		end
		if descendant:IsA("BasePart") and not isInBuilderFolder(descendant) then
			local size = descendant.Size
			if math.max(size.X, size.Y, size.Z) >= 0.2 and descendant.Transparency < 0.95 then
				local color = descendant.Color
				local shape = "Block"
				if descendant:IsA("Part") then
					shape = descendant.Shape.Name
				end
				table.insert(parts, {
					name = descendant.Name,
					className = descendant.ClassName,
					position = { round2(descendant.Position.X), round2(descendant.Position.Y), round2(descendant.Position.Z) },
					size = { round2(size.X), round2(size.Y), round2(size.Z) },
					color = {
						math.floor(color.R * 255 + 0.5),
						math.floor(color.G * 255 + 0.5),
						math.floor(color.B * 255 + 0.5),
					},
					material = descendant.Material.Name,
					transparency = round2(descendant.Transparency),
					anchored = descendant.Anchored,
					shape = shape,
				})
			end
		end
	end
	return parts
end

local function scanWorld()
	if not state.token then
		setStatus("Bitte zuerst mit einem Kopplungscode verbinden.", COLOR_WARN)
		return
	end
	setStatus("Spielwelt wird gescannt …")
	local parts = collectParts()
	state.lastPartCount = #parts
	local data, err = request("POST", "/api/plugin/world", {
		place = { placeId = game.PlaceId, gameName = game.Name },
		parts = parts,
	})
	if not data then
		setStatus(err or "Scan fehlgeschlagen", COLOR_WARN)
		log(tostring(err))
		return
	end
	setStatus(string.format("%d Bauteile übertragen – Bestätigung in der Web-App.", #parts), COLOR_OK)
	log(string.format("Ort: %s (%d) – %d Bauteile", game.Name, game.PlaceId, #parts))
end

-- ---------------------------------------------------------------------------
-- Nachbau in den Workspace einfügen
-- ---------------------------------------------------------------------------

local function applyMaterial(part, materialName)
	local ok, material = pcall(function()
		return Enum.Material[materialName]
	end)
	if ok and material then
		part.Material = material
	end
end

local function applyShape(part, shapeName)
	if shapeName == "Ball" then
		part.Shape = Enum.PartType.Ball
	elseif shapeName == "Cylinder" then
		part.Shape = Enum.PartType.Cylinder
	end
end

local function buildCommand(command)
	local models = command.models or {}
	local scripts = command.scripts or {}
	local totalParts = 0
	for _, modelData in ipairs(models) do
		totalParts = totalParts + #(modelData.parts or {})
	end

	local waypointOk = pcall(function()
		ChangeHistoryService:SetWaypoint("Roblox AI Builder – Start")
	end)
	if not waypointOk then
		log("Hinweis: Änderungsverlauf konnte nicht gesetzt werden.")
	end

	local folder = Instance.new("Folder")
	folder.Name = string.format("%s – %s", BUILDER_FOLDER_PREFIX, os.date("%d.%m.%Y %H:%M"))
	folder.Parent = workspace

	local inserted = 0
	local errors = {}

	for _, modelData in ipairs(models) do
		local model = Instance.new("Model")
		model.Name = modelData.name or "Modell"
		model.Parent = folder
		for _, partData in ipairs(modelData.parts or {}) do
			local success, partError = pcall(function()
				local part = Instance.new("Part")
				part.Name = partData.name or "Teil"
				part.Size = Vector3.new(partData.size[1], partData.size[2], partData.size[3])
				part.CFrame = CFrame.new(partData.position[1], partData.position[2], partData.position[3])
				part.Color = Color3.fromRGB(partData.color[1], partData.color[2], partData.color[3])
				part.Anchored = true
				part.CanCollide = true
				part.Transparency = partData.transparency or 0
				applyMaterial(part, partData.material)
				applyShape(part, partData.shape)
				part.Parent = model
			end)
			if not success then
				table.insert(errors, tostring(partError))
			end
			inserted = inserted + 1
			if inserted % 50 == 0 then
				request("POST", "/api/plugin/progress", {
					jobId = command.jobId,
					done = inserted,
					total = totalParts,
				})
				setStatus(string.format("Baue Spielwelt … %d/%d Teile", inserted, totalParts))
				task.wait()
			end
		end
	end

	for _, scriptData in ipairs(scripts) do
		local model = folder:FindFirstChild(scriptData.model)
		if model then
			local scriptInstance = Instance.new("Script")
			scriptInstance.Name = scriptData.name or "Nachbau_Skript"
			local success, scriptError = pcall(function()
				scriptInstance.Source = scriptData.source
			end)
			if not success then
				table.insert(errors, "Skript konnte nicht eingefügt werden: " .. tostring(scriptError))
			end
			scriptInstance.Parent = model
		end
	end

	request("POST", "/api/plugin/progress", {
		jobId = command.jobId,
		done = totalParts,
		total = totalParts,
	})
	request("POST", "/api/plugin/complete", {
		jobId = command.jobId,
		inserted = inserted,
		errors = errors,
	})

	pcall(function()
		ChangeHistoryService:SetWaypoint("Roblox AI Builder – Fertig")
	end)
	Selection:Set({ folder })
	setStatus(string.format("Nachbau fertig – %d Teile in '%s' eingefügt.", inserted, folder.Name), COLOR_OK)
	log(string.format("Modelle: %d · Teile: %d · Skripte: %d", #models, inserted, #scripts))
end

local function handleCommand(command)
	if command.type ~= "build" then
		return
	end
	if state.building then
		log("Ein Nachbau läuft bereits.")
		return
	end
	state.building = true
	setStatus("Nachbau wird eingefügt …")
	task.spawn(function()
		local ok, err = pcall(buildCommand, command)
		if not ok then
			setStatus("Fehler beim Einfügen: " .. tostring(err), COLOR_WARN)
			request("POST", "/api/plugin/complete", {
				jobId = command.jobId,
				inserted = 0,
				errors = { tostring(err) },
			})
		end
		state.building = false
	end)
end

-- ---------------------------------------------------------------------------
-- Hintergrundschleifen
-- ---------------------------------------------------------------------------

local function heartbeat()
	local data, err = request("POST", "/api/plugin/heartbeat", {
		place = { placeId = game.PlaceId, gameName = game.Name },
		partCount = state.lastPartCount,
	})
	if not data then
		if not state.building then
			setStatus(err or "Verbindung verloren", COLOR_WARN)
		end
		return
	end
	if not state.building then
		setStatus(string.format("Verbunden – %s", game.Name), COLOR_OK)
	end
end

local function pollCommands()
	local data = request("GET", "/api/plugin/commands")
	if not data then
		return
	end
	for _, command in ipairs(data.commands or {}) do
		handleCommand(command)
	end
end

local function startLoops()
	if state.loopsStarted then
		return
	end
	state.loopsStarted = true
	task.spawn(function()
		while true do
			if state.token then
				pcall(heartbeat)
			end
			task.wait(HEARTBEAT_SECONDS)
		end
	end)
	task.spawn(function()
		while true do
			if state.token and not state.building then
				pcall(pollCommands)
			end
			task.wait(POLL_SECONDS)
		end
	end)
end

-- ---------------------------------------------------------------------------
-- Aktionen der Oberfläche
-- ---------------------------------------------------------------------------

local function connect()
	local code = string.upper((string.gsub(codeBox.Text or "", "[^%w]", "")))
	if #code < 6 then
		setStatus("Bitte den 6-stelligen Kopplungscode eingeben.", COLOR_WARN)
		return
	end
	state.baseUrl = normalizeUrl(urlBox.Text)
	urlBox.Text = state.baseUrl
	plugin:SetSetting("baseUrl", state.baseUrl)
	setStatus("Verbinde mit dem Server …")

	local data, err = request("POST", "/api/plugin/pair", { code = code })
	if not data then
		setStatus(err or "Kopplung fehlgeschlagen", COLOR_WARN)
		log("Tipp: In der Web-App einen neuen Code erzeugen und 'Allow HTTP Requests' aktivieren.")
		return
	end

	state.token = data.token
	state.userName = data.user and data.user.name or "Roblox-Konto"
	plugin:SetSetting("token", state.token)
	plugin:SetSetting("userName", state.userName)
	codeBox.Text = ""
	setStatus("Verbunden als " .. state.userName, COLOR_OK)
	startLoops()
	task.defer(scanWorld)
end

local function disconnect()
	state.token = nil
	plugin:SetSetting("token", nil)
	setStatus("Verbindung getrennt", COLOR_WARN)
	log("Neuen Kopplungscode in der Web-App erzeugen und erneut verbinden.")
end

connectButton.MouseButton1Click:Connect(connect)
scanButton.MouseButton1Click:Connect(function()
	task.spawn(scanWorld)
end)
disconnectButton.MouseButton1Click:Connect(disconnect)

openButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

if state.token then
	setStatus("Verbunden als " .. tostring(state.userName or "Roblox-Konto"), COLOR_OK)
	startLoops()
else
	setStatus("Nicht verbunden – Kopplungscode eingeben", COLOR_WARN)
end
